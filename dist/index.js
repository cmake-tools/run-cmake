const core = require('@actions/core');
const exec = require('@actions/exec');
require('which');
const compare_version = require('compare-versions');
const io = require('@actions/io');
const path = require('path');
const parser = require('action-input-parser');
const os = require("node:os");
require('@actions/artifact');
require('node:stream/consumers');
require('dotenv').config();
require('@actions/glob');

function os_is()
{
  if(process.env.MSYSTEM !== undefined) return String(process.env.MSYSTEM).toLowerCase()
  if(process.env.CYGWIN) return 'cygwin'
  else return process.platform
}

class Generator
{
  name = ''
  support_toolset = false
  support_platform = false
  platforms = Array()
  constructor(name, toolset, platform, platforms)
  {
    this.name = name;
    this.support_toolset = toolset;
    this.support_platform = platform;
    this.platforms = platforms;
  }
}

class CMake
{
  static #m_version = '0'; // the CMake version
  static #m_version_major = 0;
  static #m_version_minor = 0;
  static #m_version_patch = 0;
  static #m_version_suffix = 0;
  static #m_isDirty = false; // CMake is beta etc...
  static #m_capacities = null
  static #m_tls = -1
  static #m_debugger = -1
  static #m_default_cc_cxx= ''



  static #m_generators = new Map()
  static #m_generator = ''
  static #m_mode = ''
  static #m_default_generator = ''
  static #m_nbrCPU = '1'

  static async init()
  {
    if(!process.env.cmake_version) await this.#infos();
    else this.#m_version=process.env.cmake_version;
    this.#m_nbrCPU = String(os.availableParallelism());
    this.#parseMode();
    this.#parseBuildDir();
    return this;
  }

  static is_greater_equal(version)
  {
    return compare_version.compare(this.#m_version, version, '>=')
  }

  static version() { return this.#m_version }

  static generators() { return this.#m_generators }

  static mode() { return this.#m_mode}

  static default_generator() { return this.#m_default_generator }

  static async #infos()
  {
    let cout ='';
    let cerr ='';
    const options = {};
    options.listeners =
    {
      stdout: (data) => { cout += data.toString(); },
      stderr: (data) => { cerr += data.toString(); }
    };
    options.silent = true;
    options.failOnStdErr = false;
    options.ignoreReturnCode = true;
    await run('cmake',['-E','capabilities'], options);
    if(cout!='')
    {
      this.#m_capacities=JSON.parse(cout);
      cout ='';
      cerr ='';
    }
    // if we are here and we don't have a CMake Error so CMake has lib problems ! Fix this fucking shitty Ubuntu
    else if(!cerr.includes('CMake Error'))
    {
      await this.#fixCMake();
      cout ='';
      cerr ='';
      await run('cmake',['-E','capabilities'], options);
    }
    this.#parseVersion(cerr); // pass cerr to handle the case this.#m_capacities=JSON.parse(cout) fails because of very old CMake
    await this.#parseGenerators();
    await this.#parseOtherInfos();
  }

  static async #fixCMake()
  {
    if(!global.fix_done)
    {
      let ret;
      const options = {};
      options.silent = true;
      if( await os_is() === "linux")
      {
        ret = await exec.exec('sudo apt-get update', [], options);
        if(ret!=0) return ret;
        ret = await exec.exec('sudo apt-get install --no-install-recommends -y libidn12', [], options);
        if(ret!=0) return ret;
        ret = await exec.exec('sudo ln -sf /usr/lib/x86_64-linux-gnu/libidn.so.12 /usr/lib/x86_64-linux-gnu/libidn.so.11', [], options);
        if(ret!=0) return ret;
        global.fix_done = true;
      }
    }
    return 0;
  }

  static #parseVersion(string)
  {
    if(this.#m_capacities!==null)
    {
      this.#m_version=this.#m_capacities.version.string.match(/\d\.\d[\\.\d]+/)[0];
      this.#m_version_major=this.#m_capacities.version.major;
      this.#m_version_minor=this.#m_capacities.version.minor;
      this.#m_version_patch=this.#m_capacities.version.patch;
      this.#m_version_suffix=this.#m_capacities.version.suffix;
      this.#m_isDirty=this.#m_capacities.version.isDirty;
    }
    else
    {
      const match = string.match(/\d+\.\d+(?:\.\d+)?/);
      this.#m_version = match ? match[0] : "0.0.0";
      [this.#m_version_major, this.#m_version_minor, this.#m_version_patch] = this.#m_version.split('.').map(Number);
    }
    core.exportVariable('cmake_version', this.#m_version);
  }

  static async #parseGenerators()
  {
    if(this.#m_capacities!==null)
    {
      for(let i= 0 ; i!= this.#m_capacities.generators.length; ++i)
      {
        let name = this.#m_capacities.generators[i].name;
        let toolsetSupport = this.#m_capacities.generators[i].toolsetSupport;
        let platformSupport = this.#m_capacities.generators[i].platformSupport;
        let platforms = Array();
        if(this.#m_capacities.generators[i].supportedPlatforms!== undefined)
        {
          platforms= this.#m_capacities.generators[i].supportedPlatforms;
        }
        this.#m_generators.set(name,new Generator(name,toolsetSupport,platformSupport,platforms));
      }
    }
    // Read the default generator or parse the generators if CMake is old
    let cout ='';
    const options = {};
    options.listeners =
    {
      stdout: (data) => { cout += data.toString(); },
      stderr: (data) => { cout += data.toString(); }
    };
    options.silent = true;
    options.failOnStdErr = false;
    options.ignoreReturnCode = true;
    if(this.#m_capacities!==null && this.is_greater_equal('3.14')) // we can deduce default generator with * with CMake 3.14
    {
      await run('cmake',['--help'], options);
      cout = cout.substring(cout.indexOf("Generators") + 10);
      cout=cout.replace("\r", "");
      cout=cout.split("\n");
      for(const element of cout)
      {
        if(element.includes('*') && element.includes('='))
        {
          let gen=element.split("=");
          gen=gen[0].replace("*", "");
          gen=gen.trim();
          this.#m_default_generator=gen;
        }
      }
    }
    else if(this.#m_capacities==null) // we need to parse all to have the generators
    {
      await run('cmake',['--help'], options);
      cout = cout.substring(cout.indexOf("Generators") + 10);
      cout=cout.replace("\r", "");
      cout=cout.split("\n");
      for(const line of cout)
      {
        if(line.includes('='))
        {
          if(line==''||line.includes('CodeBlocks')||line.includes('CodeLite')||line.includes('Eclipse')||line.includes('Kate')||line.includes('Sublime Text')||line.includes('KDevelop3')) continue;
          let element=line.split("=");
          if(element[0].includes("*"))
          {
            element=element[0].replace("*", " ");
            element=element.trim();
            this.#m_default_generator=element;
          }
          else element=element[0].trim();
          this.#m_generators.set(element,new Generator(element,false,false,[]));
        }
      }
    }
    // We need to fill this.#m_default_generator by ourself
    await this.#determineDefaultGenerator();
  }

  static async #determineDefaultGenerator()
  {
    switch(os_is())
    {
      case "linux":
      {
        if(this.#m_default_generator=='') this.#m_default_generator = 'Unix Makefiles';
        break
      }
      case "darwin":
      {
        if(this.#m_default_generator=='') this.#m_default_generator = 'Xcode';
        if(!this.is_greater_equal('3.14')) this.#m_default_generator = 'Unix Makefiles';
        if(process.env.SDKROOT===undefined)
        {
          let cout = '';
          let cerr = '';
          const options = {};
          options.failOnStdErr = false;
          options.ignoreReturnCode = true;
          options.listeners =
          {
            stdout: (data) => { cout += data.toString(); },
            stderr: (data) => { cerr += data.toString(); },
          };
          options.silent = true;
          await exec.exec('xcode-select', ['--install'],options);
          await exec.exec('xcrun', ['--show-sdk-path'],options);
          process.env.SDKROOT=cout.replace('\n','').trim();
          cout = '';
          cerr = '';
          await exec.exec('xcrun', ['--find','clang'],options);
          cout=cout.replace('\n','').trim();
          if(process.env.CC == '' || process.env.CC === undefined) process.env.CC = cout;
          if(process.env.CXX == '' || process.env.CXX === undefined) process.env.CXX = String(cout + '++');
          if(!this.is_greater_equal('3.14')) this.#m_default_cc_cxx=[`-DCMAKE_C_COMPILER:PATH=${process.env.CC}`,`-DCMAKE_CXX_COMPILER:PATH=${process.env.CXX}`];
        }
        break
      }
      case "win32":
      {
        // Read CC CXX
        if(process.env.CC !== undefined && (process.env.CC.includes('gcc')||process.env.CC.includes('clang')))
        {
          this.#m_default_generator = 'Unix Makefiles';
        }
        if(process.env.CXX !== undefined && (process.env.CXX.includes('g++')||process.env.CXX.includes('clang++')))
        {
          this.#m_default_generator = 'Unix Makefiles';
        }
        if(this.#m_default_generator=='')
        {
          if(this.#m_generators.get('Visual Studio 17 2022')!= undefined) this.#m_default_generator = 'Visual Studio 17 2022';
          else if (this.#m_generators.get('Visual Studio 16 2019')!= undefined) this.#m_default_generator = 'Visual Studio 16 2019';
          else this.#m_default_generator = 'NMake Makefiles';
        }
        break
      }
    }
  }

  static async  #parseOtherInfos()
  {
    if(this.#m_capacities!==null)
    {
      this.#m_tls = this.#m_capacities.tls;
      this.#m_debugger = this.#m_capacities.debugger;
    }
  }

  /* Detect which mode the user wants :
  - configure: CMake configure the project only.
  - build: CMake build the project only.
  - install: CMake install the project.
  - all: CMake configure, build and install in a row.
  By default CMake is in configure mode.
  */
  static #parseMode()
  {
    this.#m_mode = parser.getInput({key: 'mode', type: 'string', required: false, default: 'configure', disableable: false });
    if(this.#m_mode!='configure' && this.#m_mode!='build' && this.#m_mode!='install' && this.#m_mode!='all') throw String('mode should be configure, build, install or all')
  }

  // Before CMake 3.13 -B -S is not available so we need to run cmake in the binary folder in config mode
  static #working_directory()
  {
    if(this.is_greater_equal('3.13')) return path.resolve('./')
    else return process.env.binary_dir
  }

  static #parseBuildDir()
  {
    let binary_dir = parser.getInput({key: 'binary_dir', type: 'string', required: false, default: process.env.binary_dir !== undefined ? process.env.binary_dir : './build' , disableable: false });
    binary_dir=path.resolve(binary_dir);
    core.exportVariable('binary_dir', binary_dir);
  }

  // Generate a Project Buildsystem (https://cmake.org/cmake/help/latest/manual/cmake.1.html#generate-a-project-buildsystem)

  //-S <path-to-source> Path to root directory of the CMake project to build.
  static #source_dir()
  {
    let source_dir = parser.getInput({key: 'source_dir', type: 'string', required: false, default: process.env.GITHUB_WORKSPACE !== undefined ? process.env.GITHUB_WORKSPACE : './' , disableable: false });
    source_dir=path.resolve(source_dir);
    if(this.is_greater_equal('3.13')) return Array('-S',source_dir)
    else return Array(source_dir)
  }

  //-B <path-to-build> Path to directory which CMake will use as the root of build directory.
  static #build_dir()
  {
    if(this.is_greater_equal('3.13')) return Array('-B',process.env.binary_dir)
    else
    {
      io.mkdirP(process.env.binary_dir);
      return Array()
    }
  }

  //-C <initial-cache> Pre-load a script to populate the cache.
  static #initial_cache()
  {
    let initial_cache = parser.getInput({key: 'initial_cache', type: 'string', required: false, default: '' , disableable: false });
    if(initial_cache!='')
    {
      initial_cache=path.posix.resolve(initial_cache);
      return Array('-C',initial_cache)
    }
    else return Array()
  }

  //-D <var>:<type>=<value>, -D <var>=<value
  static #variables()
  {
    const value = parser.getInput({key: 'variables', type: 'array', required: false, default: [] , disableable: false });
    let ret=[];
    for(const i in value)
    {
      ret=ret.concat('-D',value[i]);
    }
    return ret;
  }

  //-U <globbing_expr>
  static #remove_variables()
  {
    const value = parser.getInput({key: 'remove_variables', type: 'array', required: false, default: [] , disableable: false });
    let ret=[];
    for(const i in value)
    {
      ret=ret.concat('-U',value[i]);
    }
    return ret;
  }

  //-G <generator-name>
  static #generator()
  {
    this.#m_generator = parser.getInput({key: 'generator', type: 'string', required: false, default: this.#m_default_generator, disableable: false });
    if(this.#m_generator!='') return Array('-G',this.#m_generator)
  }

  //-T <toolset-spec>
  static #toolset()
  {
    let generator_infos = this.#m_generators.get(this.#m_generator);
    let toolset = parser.getInput({key: 'toolset', type: 'string', required: false, default: '', disableable: false });
    let has_toolset_info = false;
    if(generator_infos != undefined) has_toolset_info=true;
    if(toolset!='' && has_toolset_info==true && generator_infos.support_toolset == true) return Array('-T',toolset)
    else if (toolset!='' && has_toolset_info==true && generator_infos.support_toolset == false ) core.warning('toolset is not needed');
    else if (toolset!='' && has_toolset_info==false ) return Array('-T',toolset)
    return Array()
  }

  //-A <platform-name>
  static #platform()
  {
    let generator_infos = this.#m_generators.get(this.#m_generator);
    let platform = core.getInput('platform', { required: false }); // don't use parser.getInput here !!!
    let has_platform_info = false;
    if(generator_infos != undefined) has_platform_info=true;
    if(this.is_greater_equal('3.1'))
    {
      if(platform!='' && has_platform_info== true && generator_infos.support_platform == true) return Array('-A',platform)
      else if(platform!='' && has_platform_info== true && generator_infos.support_platform==false) core.warning('platform is not needed');
      else if(platform!='' && has_platform_info== false) return Array('-A',platform)
      return Array()
    }
    else if(platform!='') return String(' '+platform)
    else return String('')
  }

  //--toolchain <path-to-file>
  static #toolchain()
  {
    let toolchain = parser.getInput({key: 'toolchain', type: 'string', required: false, default: '', disableable: false });
    if(toolchain!='')
    {
      if(this.is_greater_equal('3.21.0')) return Array('--toolchain',toolchain)
      else return Array('-DCMAKE_TOOLCHAIN_FILE:PATH='+toolchain)
    }
    return Array()
  }

  //--install-prefix <directory>
  static #install_prefix()
  {
    let install_prefix = parser.getInput({key: 'install_prefix', type: 'string', required: false, default: '', disableable: false });
    if(install_prefix!='')
    {
      install_prefix=path.resolve(install_prefix);
      if(this.is_greater_equal('3.21') && os_is()!='cygwin') return Array('--install-prefix',install_prefix)
      else return Array('-DCMAKE_INSTALL_PREFIX:PATH='+install_prefix)
    }
    return Array()
  }

  //--project-file <project-file-name>
  static #project_file()
  {
    if(this.is_greater_equal('4.0'))
    {
      let project_file = parser.getInput({key: 'project_file', type: 'string', required: false, default: '', disableable: false });
      if(project_file!='')
      {
        return Array('--project-file',project_file)
      }
    }
    return Array()
  }

  // -Wno-dev -Wdev -Wdeprecated -Wno-deprecated
  static #configure_warnings()
  {
    let configure_warnings = parser.getInput({key:'configure_warnings', type: 'string', required: false, default:'none', disableable: false });
    if(configure_warnings=='') return []
    if(configure_warnings=='none')
    {
      return Array('-Wno-dev')
    }
    else if(configure_warnings=='deprecated')
    {
      if(! this.is_greater_equal('3.5')) return Array('-Wdev')
      else return Array('-Wno-dev','-Wdeprecated')
    }
    else if(configure_warnings=='warning')
    {
      if(! this.is_greater_equal('3.5')) return Array('-Wdev')
      else return Array('-Wdev','-Wno-deprecated')
    }
    else if(configure_warnings=='developer')
    {
      return Array('-Wdev')
    }
    else throw String('configure_warnings should be : none, deprecated, warning or developer. Received : '+configure_warnings)
  }

  // -Wno-dev -Wdev -Wdeprecated -Wno-deprecated
  static #configure_warnings_as_errors()
  {
    let configure_warnings_as_errors = parser.getInput({ key:'configure_warnings_as_errors', type:'string', required: false, default:'none', disableable: false  });
    if(configure_warnings_as_errors=='') return []
    if(configure_warnings_as_errors=='none')
    {
      if(! this.is_greater_equal('3.5')) return []
      else return Array('-Wno-error=dev')
    }
    else if(configure_warnings_as_errors=='deprecated')
    {
      if(! this.is_greater_equal('3.5')) return []
      else return Array('-Wno-error=dev','-Werror=deprecated')
    }
    else if(configure_warnings_as_errors=='warning')
    {
      if(! this.is_greater_equal('3.5')) return []
      else return Array('-Werror=dev','-Wno-error=deprecated')
    }
    else if(configure_warnings_as_errors=='developer')
    {
      return Array('-Werror=dev')
    }
    else throw String('configure_warnings_as_errors should be : none, deprecated, warning or developer. Received : '+configure_warnings_as_errors)
  }

  static async #fresh()
  {
    let fresh = parser.getInput({key:'fresh', type: 'boolean', required: false, default:false, disableable: false });
    if(fresh)
    {
      if(this.is_greater_equal('3.24')) return Array('--fresh')
      else
      {
        await io.rmRF(process.env.binary_dir+"/CMakeCache.txt");
        await io.rmRF(process.env.binary_dir+"/CMakeFiles");
      }
    }
    return Array()
  }

  // -L[A][H] List non-advanced cached variables.
  static #list_cache_variables()
  {
    let list_cache_variables = parser.getInput({ key:'list_cache_variables', type:'string', required: false, default:'', disableable: false });
    if(list_cache_variables=='') return []
    else if(list_cache_variables=='cache') return Array('-L')
    else if(list_cache_variables=='cache_help') return Array('-LH')
    else if(list_cache_variables=='advanced') return Array('-LA')
    else if(list_cache_variables=='advanced_help') return Array('-LAH')
    else if(list_cache_variables=='off') return []
    else throw String('list_cache_variables should be : cache, cache_help, advanced or advanced_help. Received : '+list_cache_variables)
  }

  // -LR[A][H] <regex>
  static #list_cache_variables_regex()
  {
    let value = parser.getInput({ key:'list_cache_variables_regex', type:'array', required: false, default:[], disableable: false });
    let ret=[];
    for(const i in value)
    {
      ret=ret.concat('-LR',value[i]);
    }
    return ret;
  }

    static #list_cache_help_variables_regex()
  {
    let value = parser.getInput({ key:'list_cache_help_variables_regex', type:'array', required: false, default:[], disableable: false });
    let ret=[];
    for(const i in value)
    {
      ret=ret.concat('-LRH',value[i]);
    }
    return ret;
  }

    static #list_cache_advanced_variables_regex()
  {
    let value = parser.getInput({ key:'list_cache_advanced_variables_regex', type:'array', required: false, default:[], disableable: false });
    let ret=[];
    for(const i in value)
    {
      ret=ret.concat('-LRA',value[i]);
    }
    return ret;
  }

  static #list_cache_advanced_help_variables_regex()
  {
    let value = parser.getInput({ key:'list_cache_advanced_help_variables_regex', type:'array', required: false, default:[], disableable: false });
    let ret=[];
    for(const i in value)
    {
      ret=ret.concat('-LRAH',value[i]);
    }
    return ret;
  }

  // NO NEED -N

  static #graphviz()
  {
    let graphviz = parser.getInput({ key:'graphviz', type: 'string', required: false, default:'', disableable: false});
    if(graphviz=='')
    {
      return []
    }
    else
    {
      graphviz=path.resolve(graphviz);
      return Array('--graphviz='+graphviz)
    }
  }

  // NO --system-information [file]
  // NO --print-config-dir

  static #log_level()
  {
    let log_level = parser.getInput({ key:'log_level', type:'string', required: false, default:'', disableable: false });
    if(log_level!='')
    {
      if(log_level!='ERROR' && log_level!='WARNING' && log_level!='NOTICE' && log_level!='STATUS' && log_level!='VERBOSE' && log_level!='DEBUG' && log_level!='TRACE') throw String('log_level should be : ERROR, WARNING, NOTICE, STATUS, VERBOSE, DEBUG, TRACE. Received : '+log_level)
      if( this.is_greater_equal('3.15') && !this.is_greater_equal('3.16')) return ['--loglevel='+log_level]
      else if ( this.is_greater_equal('3.15') ) return ['--log-level='+log_level]
    }
    return []
  }

  static #log_context()
  {
    let log_level = parser.getInput({ key:'log_context', type:'boolean', required: false, default:'false', disableable: false });
    if( this.is_greater_equal('3.17') && log_level==true) return ['--log-context']
    return []
  }

  static #sarif_output()
  {
    let sarif_output = parser.getInput({ key:'sarif_output', type: 'string', required: false, default:'', disableable: false });
    if(sarif_output!='')
    {
      sarif_output=path.resolve(sarif_output);
      if( this.is_greater_equal('4.0')) return ['--sarif-output='+sarif_output]
    }
    return []
  }

  static #debug_trycompile()
  {
    let value = parser.getInput({key:'debug_trycompile', type: 'boolean', required: false, default:false, disableable: false });
    if(value) return Array('--debug-trycompile')
    return Array()
  }

  static #debug_output()
  {
    let debug_output = parser.getInput({key:'debug_output', type: 'boolean', required: false, default:false, disableable: false });
    if(debug_output)
    {
      return ['--debug-output']
    }
    return []
  }

  static #debug_find()
  {
    let debug_find = parser.getInput({ key:'debug_find', type: 'boolean', required: false, default:false, disableable: false });
    if(debug_find)
    {
      if( this.is_greater_equal('3.17')) return ['--debug-find']
    }
    return []
  }

  static #debug_find_pkg()
  {
    let debug_find_pkg = parser.getInput({ key:'debug_find_pkg', type: 'string', required: false, default:'', disableable: false });
    if(debug_find_pkg!='')
    {
      if( this.is_greater_equal('3.23')) return ['--debug-find-pkg='+debug_find_pkg]
    }
    return []
  }

  static #debug_find_var()
  {
    let debug_find_var = parser.getInput({ key:'debug_find_var', type: 'string', required: false, default:'', disableable: false });
    if(debug_find_var!='')
    {
      if( this.is_greater_equal('3.23')) return ['--debug-find-var='+debug_find_var]
    }
    return []
  }

  static #trace()
  {
    let trace = parser.getInput({ key:'trace', type: 'string', required: false, default:'', disableable: false });
    if(trace!='' && trace!='trace' && trace!='expand' ) throw String('trace should be : "", trace or expand. Received : '+trace)
    else if (trace=='trace') return Array('--trace')
    else if (trace=='expand') return Array('--trace-expand')
    return []
  }

  static #trace_format()
  {
    let trace = parser.getInput({ key:'trace_format', type: 'string', required: false, default:'', disableable: false });
    if( this.is_greater_equal('3.17'))
    {
      if(trace!=''&& trace!='human' && trace!='json-v1' ) throw String('trace_format should be : "", human or json-v1. Received : '+trace)
      if(trace!='') return Array('--trace-format='+trace)
    }
    return []
  }

  static #trace_source()
  {
    let value = parser.getInput({ key:'trace_source', type:'array', required: false, default:[], disableable: false });
    let ret=[];
    for(const i in value)
    {
      ret=ret.concat('--trace-source='+value[i]);
    }
    return ret;
  }

  static #trace_redirect()
  {
    let trace = parser.getInput({ key:'trace_redirect', type: 'string', required: false, default:'', disableable: false });
    if(trace!='') return Array('--trace-redirect='+trace)
    return []
  }

  static #warn_uninitialized()
  {
    let debug_find = parser.getInput({ key:'warn_uninitialized', type: 'boolean', required: false, default:false, disableable: false });
    if(debug_find) return ['--warn-uninitialized']
    return []
  }

  static #no_warn_unused_cli()
  {
    let debug_find = parser.getInput({ key:'no_warn_unused_cli', type: 'boolean', required: false, default:false, disableable: false });
    if(debug_find) return ['--no-warn-unused-cli']
    return []
  }

  static #check_system_vars()
  {
    let value = parser.getInput({ key:'check_system_vars', type: 'boolean', required: false, default:false, disableable: false });
    if(value) return ['--check-system-vars']
    return []
  }

  static #compile_no_warning_as_error()
  {
    let value = parser.getInput({ key:'compile_no_warning_as_error', type: 'boolean', required: false, default:false, disableable: false });
    if( this.is_greater_equal('3.24')) if(value) return ['--compile-no-warning-as-error']
    return []
  }

  static #link_no_warning_as_error()
  {
    let value = parser.getInput({ key:'link_no_warning_as_error', type: 'boolean', required: false, default:false, disableable: false });
    if( this.is_greater_equal('4.0')) if(value) return ['--link-no-warning-as-error']
    return []
  }

  static #profiling_output()
  {
    let trace = parser.getInput({ key:'profiling_output', type: 'string', required: false, default:'', disableable: false });
    if( this.is_greater_equal('3.18') && trace!='') return Array('--profiling-output='+trace)
    return []
  }

  static #profiling_format()
  {
    let trace = parser.getInput({ key:'profiling_format', type: 'string', required: false, default:'', disableable: false });
    if( this.is_greater_equal('3.18')&& trace!='') return Array('--profiling-format='+trace)
    return []
  }

  static #preset()
  {
    let trace = parser.getInput({ key:'preset', type: 'string', required: false, default:'', disableable: false });
    if( this.is_greater_equal('3.19')&& trace!='') return Array('--preset '+trace)
    return []
  }

  static #debugger()
  {
    let value = parser.getInput({ key:'debugger', type: 'boolean', required: false, default:false, disableable: false });
    if( this.is_greater_equal('3.27')) if(value) return ['--debugger']
    return []
  }

  static #debugger_pipe()
  {
    let trace = parser.getInput({ key:'debugger_pipe', type: 'string', required: false, default:'', disableable: false });
    if( this.is_greater_equal('3.27')&& trace!='') return Array('--debugger-pipe '+trace)
    return []
  }

  static #debugger_dap_log()
  {
    let trace = parser.getInput({ key:'debugger_dap_log', type: 'string', required: false, default:'', disableable: false });
    if( this.is_greater_equal('3.27')&& trace!='') return Array('--debugger-dap-log '+trace)
    return []
  }

  static async configure()
  {
    let command = [];
    if(this.#m_default_cc_cxx!='') command=command.concat(this.#m_default_cc_cxx);
    if(this.is_greater_equal('3.13')) command=command.concat(this.#source_dir());
    command=command.concat(this.#build_dir());
    command=command.concat(this.#initial_cache());
    command=command.concat(this.#variables());
    command=command.concat(this.#remove_variables());
    if(!this.is_greater_equal('3.1'))
    {
      command=command.concat(this.#generator()[0]);
      command=command.concat(this.#generator()[1]+this.#platform());
    }
    else
    {
      command=command.concat(this.#generator());
    }
    command=command.concat(this.#toolset());
    if(this.is_greater_equal('3.1')) command=command.concat(this.#platform());
    command=command.concat(this.#toolchain());
    command=command.concat(this.#install_prefix());
    command=command.concat(this.#project_file());
    command=command.concat(this.#configure_warnings());
    command=command.concat(this.#configure_warnings_as_errors());
    command=command.concat(await this.#fresh());
    command=command.concat(this.#list_cache_variables());
    command=command.concat(this.#list_cache_variables_regex());
    command=command.concat(this.#list_cache_help_variables_regex());
    command=command.concat(this.#list_cache_advanced_variables_regex());
    command=command.concat(this.#list_cache_advanced_help_variables_regex());
    command=command.concat(this.#graphviz());
    command=command.concat(this.#log_level());
    command=command.concat(this.#log_context());
    command=command.concat(this.#sarif_output());
    command=command.concat(this.#debug_trycompile());
    command=command.concat(this.#debug_output());
    command=command.concat(this.#debug_find());
    command=command.concat(this.#debug_find_pkg());
    command=command.concat(this.#debug_find_var());
    command=command.concat(this.#trace());
    command=command.concat(this.#trace_format());
    command=command.concat(this.#trace_source());
    command=command.concat(this.#trace_redirect());
    command=command.concat(this.#warn_uninitialized());
    command=command.concat(this.#no_warn_unused_cli());
    command=command.concat(this.#check_system_vars());
    command=command.concat(this.#compile_no_warning_as_error());
    command=command.concat(this.#link_no_warning_as_error());
    command=command.concat(this.#profiling_output());
    command=command.concat(this.#profiling_format());
    command=command.concat(this.#preset());
    command=command.concat(this.#debugger());
    command=command.concat(this.#debugger_pipe());
    command=command.concat(this.#debugger_dap_log());
    if(!this.is_greater_equal('3.13')) command=command.concat(this.#source_dir()); // Must be the last one in this case
    let cout = '';
    let cerr = '';
    const options = {};
    options.silent = false;
    options.failOnStdErr = false;
    options.ignoreReturnCode = true;
    options.listeners =
    {
      stdout: (data) => { cout += data.toString(); },
      stderr: (data) => { cerr += data.toString(); },
      errline: (data) => { console.log(data); },
    };
    options.cwd = this.#working_directory();
    console.log(`Running CMake v${this.version()} in configure mode with generator ${this.#m_generator} (Default generator : ${this.default_generator()})`);
    let ret = await run('cmake',command,options);
    if(ret!=0) core.setFailed(cerr);
  }

  // BUILD PARAMETER

  // --build <dir>

  static #parallel()
  {
    if(!this.is_greater_equal('3.12')) return []
    let value = parser.getInput({ key:'parallel', type: 'string', required: false, default:this.#m_nbrCPU, disableable: false });
    value = parseInt(value, 10);
    if(isNaN(value)||value<=0)
    {
      core.warning('parallel should be a number >=1 ('+String(value)+')');
      value=1;
    }
    return Array('--parallel',String(value))
  }

  static #preset_build()
  {
    let trace = parser.getInput({ key:'preset_build', type: 'string', required: false, default:'', disableable: false });
    if( this.is_greater_equal('3.19')&& trace!='') return Array('--preset '+trace)
    return []
  }

  // NO --list-presets

  static #targets()
  {
    let targets = parser.getInput({key: 'targets', type: 'string', required: false, default: '' , disableable: false });
    if(targets!='')
    {
      if(this.is_greater_equal('3.15')) return Array('--target').concat(targets.split(' '))
      else
      {
        return targets.split(' ')
      }
    }
    return []
  }

  static #config()
  {
    let config = parser.getInput({key: 'config', type: 'string', required: false, default: process.env.config !== undefined ? process.env.config : 'Debug' , disableable: false });
    if(config!='')
    {
      core.exportVariable('config', config);
      return Array('--config',config)
    }
    return Array()
  }

  static #clean_first()
  {
    let value = parser.getInput({ key:'clean_first', type: 'boolean', required: false, default:false, disableable: false });
    if(value) return ['--clean-first']
    return []
  }

  static #resolve_package_references()
  {
    let value = parser.getInput({key: 'resolve_package_references', type: 'string', required: false, default: '' , disableable: false });
    if(this.is_greater_equal('3.23'))
    {
      if(value=='on' || value=='off' || value=='only') return ['--resolve-package-references='+value]
    }
    return []
  }

  static #build_verbose()
  {
    delete process.env.VERBOSE;
    delete process.env.CMAKE_VERBOSE_MAKEFILE;
    const build_verbose = parser.getInput({ key:'build_verbose', type: 'boolean', required: false, default: false, disableable: false});
    if(build_verbose)
    {
      if( this.is_greater_equal('3.14'))
      {
        return Array('--verbose')
      }
      else
      {
        process.env.VERBOSE="TRUE";
        process.env.CMAKE_VERBOSE_MAKEFILE="TRUE";
        return []
      }
    }
    return []
  }

  static #to_native_tool()
  {
    const to_native_tool = parser.getInput({ key:'to_native_tool', type: 'array',required: false, default:[], disableable: false});
    if(to_native_tool.length == 0) return []
    else
    {
      let ret = ['--'];
      ret=ret.concat(to_native_tool);
      return ret
    }
  }

  static async build()
  {
    let cout = '';
    let cerr = '';
    const options = {};
    options.silent = false;
    options.failOnStdErr = false;
    options.ignoreReturnCode = true;
    options.listeners =
    {
      stdout: (data) => { cout += data.toString(); },
      stderr: (data) => { cerr += data.toString(); },
      errline: (data) => {console.log(data); },
    };
    this.#parseBuildDir();
    if(this.is_greater_equal('3.15'))
    {
      let command = ['--build',process.env.binary_dir];
      command=command.concat(this.#parallel());
      command=command.concat(this.#preset_build());
      command=command.concat(this.#targets());
      command=command.concat(this.#config());
      command=command.concat(this.#clean_first());
      command=command.concat(this.#resolve_package_references());
      command=command.concat(this.#build_verbose());
      command=command.concat(this.#to_native_tool());
      console.log(`Running CMake v${this.version()} in build mode`);
      let ret = await run('cmake',command,options);
      if(ret!=0) core.setFailed(cerr);
    }
    else
    {
      const arr = this.#targets();
      if(arr.length == 0)
      {
        let command = ['--build',process.env.binary_dir];
        command=command.concat(this.#parallel());
        command=command.concat(this.#config());
        command=command.concat(this.#clean_first());
        command=command.concat(this.#build_verbose());
        command=command.concat(this.#to_native_tool());
        console.log(`Running CMake v${this.version()} in build mode`);
        let ret = await run('cmake',command,options);
        if(ret!=0) core.setFailed(cerr);
      }
      else
      {
        for(const target in arr)
        {
          let command = ['--build',process.env.binary_dir];
          command=command.concat(this.#parallel());
          command=command.concat('--target', arr[target]);
          command=command.concat(this.#config());
          if(target==0)command=command.concat(this.#clean_first());
          command=command.concat(this.#build_verbose());
          command=command.concat(this.#to_native_tool());
          console.log(`Running CMake v${this.version()} in build mode`);
          let ret = await run('cmake',command,options);
          if(ret!=0) core.setFailed(cerr);
        }
      }
    }
  }

  // INSTALL PARAMETERS

  static #config_install()
  {
    let value = parser.getInput({key: 'install_config', type: 'string', required: false, default: process.env.config !== undefined ? process.env.config : 'Debug' , disableable: false });
    if(this.is_greater_equal('3.15')) return Array('--config',value)
    else return ['-DBUILD_TYPE='+value]
  }

  static #component()
  {
    let value = parser.getInput({key: 'component', type: 'string', required: false, default: '' , disableable: false });
    if(value!='')
    {
      if(this.is_greater_equal('3.15')) return ['--component',value]
      else return ['-DCOMPONENT='+value]
    }
    return []
  }

  static #default_directory_permissions()
  {
    let value = parser.getInput({key: 'default_directory_permissions', type: 'string', required: false, default: '' , disableable: false });
    if(value!='' && this.is_greater_equal('3.19')) return ['--default_directory_permissions',value]
    return []
  }

  static #prefix()
  {
    let value = parser.getInput({key: 'prefix', type: 'string', required: false, default: '' , disableable: false });
    if(value!='')
    {
      if(this.is_greater_equal('3.15')) return ['--prefix',value]
      else return ['-DCMAKE_INSTALL_PREFIX='+value]
    }
    return []
  }

  static #strip()
  {
    let value = parser.getInput({key: 'strip', type: 'boolean', required: false, default: false , disableable: false });
    if(value=='true') return ['--strip']
    return []
  }

  static #install_verbose()
  {
    delete process.env.VERBOSE;
    const install_verbose = parser.getInput({ key:'install_verbose', type: 'boolean', required: false,  default: process.env.VERBOSE !== undefined ? process.env.VERBOSE : false , disableable: false });
    if(install_verbose)
    {
      if( this.is_greater_equal('3.15'))
      {
        return Array('--verbose')
      }
      else
      {
        process.env.VERBOSE="TRUE";
        return Array()
      }
    }
    return Array()
  }

  static #install_parallel()
  {
    if(!this.is_greater_equal('3.31')) return []
    let value = parser.getInput({ key:'parallel', type: 'string', required: false, default:this.#m_nbrCPU, disableable: false });
    value = parseInt(value, 10);
    if(isNaN(value)||value<=0)
    {
      core.warning('parallel should be a number >=1 ('+String(value)+')');
      value=1;
    }
    return Array('--parallel',String(value))
  }

  static async install()
  {
    this.#parseBuildDir();
    let command = [];
    if(this.is_greater_equal('3.15.0'))
    {
      command=['--install',process.env.binary_dir];
      command=command.concat(this.#config_install());
      command=command.concat(this.#component());
      command=command.concat(this.#default_directory_permissions());
      command=command.concat(this.#prefix());
      command=command.concat(this.#strip());
      command=command.concat(this.#install_verbose());
      command=command.concat(this.#install_parallel());
    }
    if(!this.is_greater_equal('3.15.0'))
    {
      command = [];
      command=command.concat(this.#config_install());
      command=command.concat(this.#component());
      command=command.concat(this.#prefix());
      command=command.concat('-P',process.env.binary_dir+'/cmake_install.cmake');
    }
    let cout = '';
    let cerr = '';
    const options = {};
    options.silent = false;
    options.failOnStdErr = false;
    options.ignoreReturnCode = true;
    options.listeners =
    {
      stdout: (data) => { cout += data.toString(); },
      stderr: (data) => { cerr += data.toString(); },
      errline: (data) => {console.log(data); },
    };
    console.log(`Running CMake v${this.version()} in install mode`);
    let ret = await run('cmake',command,options);
    if(ret!=0) core.setFailed(cerr);
  }

}

/**
 * @param {string[]} args
 * @param {object} opts
 */
async function run(cmd,args, opts)
{
  if(global.is_msys2)
  {
    const tmp_dir = process.env['RUNNER_TEMP'];
    if(!tmp_dir)
    {
      core.setFailed('environment variable RUNNER_TEMP is undefined');
      return;
    }
    const msys = path.join(tmp_dir, 'setup-msys2/msys2.cmd');
    let quotedArgs = [cmd].concat(args);
    //quotedArgs =  quotedArgs.map((arg) => {return `'${arg.replace(/'/g, `'\\''`)}'`}) // fix confused vim syntax highlighting with:
    return await exec.exec('cmd', ['/D', '/S', '/C', msys].concat(['-c', quotedArgs.join(' ')]), opts)
  }
  else return await exec.exec(cmd,args,opts)
}

async function main()
{
  try
  {
    let cmake = await CMake.init();
    switch(cmake.mode())
    {
      case 'configure':
      {
        await cmake.configure();
        break
      }
      case 'build':
      {
        await cmake.build();
        break
      }
      case 'install':
      {
        await cmake.install();
        break
      }
      case 'all':
      {
        await cmake.configure();
        await cmake.build();
        await cmake.install();
        break
      }
    }

    //const cmake_matcher = path.join(__dirname, "cmake.json");
    //core.info('::add-matcher::' + cmake_matcher);

  }
  catch (error)
  {
    core.setFailed(error);
  }
}

main();
//# sourceMappingURL=index.js.map

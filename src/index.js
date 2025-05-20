const core = require('@actions/core');
const exec = require('@actions/exec');
const which = require('which')
const compare_version = require('compare-versions')
const io = require('@actions/io');
const path = require('path')
const parser = require('action-input-parser')
const os = require("node:os");
const artifact = require('@actions/artifact');
const { json } = require('node:stream/consumers');
require('dotenv').config();

function os_is()
{
  if(process.env.MSYSTEM !== undefined) return String(process.env.MSYSTEM).toLowerCase()
  if(process.env.CYGWIN) return 'cygwin'
  else return process.platform
}

class CMake
{
  static #m_version = '0';
  static #m_capacities = null
  static #m_generators = Array()
  static #m_generator = ''
  static #m_mode = ''
  static #m_platforms = new Map()
  static #m_default_generator = ''

  static async init()
  {
    if(!process.env.cmake_version) await this.#infos()
    else this.#m_version=process.env.cmake_version
    this.#parseMode()
    this.#parseBuildDir()
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
    let cout =''
    let cerr =''
    const options = {};
    options.listeners =
    {
      stdout: (data) => { cout += data.toString() },
      stderr: (data) => { cerr += data.toString() }
    }
    options.silent = true
    options.failOnStdErr = false
    options.ignoreReturnCode = true
    await run('cmake',['-E','capabilities'], options)
    if(cout!='')
    {
      this.#m_capacities=JSON.parse(cout)
      cout =''
      cerr =''
    }
    // if we are here and we don't have a CMake Error so CMake has lib problems ! Fix this fucking shitty Ubuntu
    else if(!cerr.includes('CMake Error'))
    {
      await this.#fixCMake()
      cout =''
      cerr =''
      await run('cmake',['-E','capabilities'], options)
    }
    this.#parseVersion(cerr)
    await this.#parseGenerators()
    await this.#parsePlatforms()
  }

  static async #parsePlatforms()
  {
    if(this.#m_capacities!==null)
    {
      for(var i= 0 ; i!= this.#m_capacities.generators.length; ++i)
      {
        let gen = this.#m_capacities.generators[i].name
        if(this.#m_capacities.generators[i].supportedPlatforms !== undefined)
        {
          let pl = new Array()
          for(var j =0; j!=this.#m_capacities.generators[i].supportedPlatforms.length; ++j)
          {
            pl.concat(this.#m_capacities.generators[i].supportedPlatforms[j])
          }
          this.#m_platforms.set(gen,pl)
        }
        else
        {
          this.#m_platforms.set(gen, Array())
        }
      }
    }
  }

  // Before CMake 3.13 -B -S is not available so we need to run cmake in the binary folder in config mode
  static #working_directory()
  {
    if(this.is_greater_equal('3.13')) return path.resolve('./')
    else return process.env.binary_dir
  }

  static #parseBuildDir()
  {
    let binary_dir = parser.getInput({key: 'binary_dir', type: 'string', required: false, default: process.env.binary_dir !== undefined ? process.env.binary_dir : './build' , disableable: false })
    binary_dir=path.resolve(binary_dir)
    core.exportVariable('binary_dir', binary_dir);
  }

  static #parseVersion(string)
  {
    if(this.#m_capacities!==null) this.#m_version=this.#m_capacities.version.string.match(/\d\.\d[\\.\d]+/)[0]
    else this.#m_version=string.match(/\d\.\d[\\.\d]+/)[0]
    core.exportVariable('cmake_version', this.#m_version);
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
    this.#m_mode = parser.getInput({key: 'mode', type: 'string', required: false, default: 'configure', disableable: false })
    if(this.#m_mode!='configure' && this.#m_mode!='build' && this.#m_mode!='install' && this.#m_mode!='all') throw String('mode should be configure, build, install or all')
  }

  static async #parseGenerators()
  {
    if(this.#m_capacities!==null)
    {
      for(var i= 0 ; i!= this.#m_capacities.generators.length; ++i)
      {
        this.#m_generators=this.#m_generators.concat(this.#m_capacities.generators[i].name)
      }
      let cout ='';
      const options = {};
      options.listeners =
      {
        stdout: (data) => { cout += data.toString() },
        stderr: (data) => { cout += data.toString() }
      }
      options.silent = true
      options.failOnStdErr = false
      options.ignoreReturnCode = true
      await run('cmake',['--help'], options)
      cout = cout.substring(cout.indexOf("Generators") + 10);
      cout=cout.replace("\r", "");
      cout=cout.split("\n");
      for(const element of cout)
      {
        if(element.includes('*') && element.includes('='))
        {
          let gen=element.split("=")
          gen=gen[0].replace("*", "")
          gen=gen.trim()
          this.#m_default_generator=gen
        }
      }
    }
    else
    {
      let cout ='';
      const options = {};
      options.listeners =
      {
        stdout: (data) => { cout += data.toString() },
        stderr: (data) => { cout += data.toString() }
      }
      options.silent = true
      options.failOnStdErr = false
      options.ignoreReturnCode = true
      await run('cmake',['--help'], options)
      cout = cout.substring(cout.indexOf("Generators") + 10);
      cout=cout.replace("\r", "");
      cout=cout.split("\n");
      for(const element of cout)
      {
        if(element.includes('='))
        {
          let gen=element.split("=");
          if(gen[0].includes("*"))
          {
            gen=gen[0].replace("*", "");
            gen=gen.trim()
            this.#m_default_generator=gen
          }
          gen=gen[0].trim()
          if(gen==''||gen.includes('CodeBlocks')||gen.includes('CodeLite')||gen.includes('Eclipse')||gen.includes('Kate')||gen.includes('Sublime Text')||gen.includes('KDevelop3')) { }
          else
          {
            this.#m_generators=this.#m_generators.concat(gen)
          }
        }
      }
    }
  }

  static async #fixCMake()
  {
    if(!global.fix_done)
    {
      let ret;
      const options = {};
      options.silent = true
      if( await os_is() === "linux")
      {
        ret = await exec.exec('sudo apt-get update', [], options)
        if(ret!=0) return ret;
        ret = await exec.exec('sudo apt-get install --no-install-recommends -y libidn12', [], options)
        if(ret!=0) return ret;
        ret = await exec.exec('sudo ln -sf /usr/lib/x86_64-linux-gnu/libidn.so.12 /usr/lib/x86_64-linux-gnu/libidn.so.11', [], options)
        if(ret!=0) return ret;
        global.fix_done = true;
      }
    }
    return 0;
  }

  // Generate a Project Buildsystem (https://cmake.org/cmake/help/latest/manual/cmake.1.html#generate-a-project-buildsystem)

  //-S <path-to-source> Path to root directory of the CMake project to build.
  static #source_dir()
  {
    let source_dir = parser.getInput({key: 'source_dir', type: 'string', required: false, default: process.env.GITHUB_WORKSPACE !== undefined ? process.env.GITHUB_WORKSPACE : './' , disableable: false })
    source_dir=path.resolve(source_dir)
    if(this.is_greater_equal('3.13')) return Array('-S',source_dir)
    else return Array(source_dir)
  }

  //-B <path-to-build> Path to directory which CMake will use as the root of build directory.
  static #build_dir()
  {
    if(this.is_greater_equal('3.13')) return Array('-B',process.env.binary_dir)
    else
    {
      io.mkdirP(process.env.binary_dir)
      return Array()
    }
  }

  //-C <initial-cache> Pre-load a script to populate the cache.
  static #initial_cache()
  {
    let initial_cache = parser.getInput({key: 'initial_cache', type: 'string', required: false, default: '' , disableable: false })
    if(initial_cache!='')
    {
      initial_cache=path.posix.resolve(initial_cache)
      return Array('-C',initial_cache)
    }
    else return Array()
  }

  //-D <var>:<type>=<value>, -D <var>=<value
  static #variables()
  {
    const value = parser.getInput({key: 'variables', type: 'array', required: false, default: [] , disableable: false })
    let ret=[]
    for(const i in value)
    {
      ret=ret.concat('-D',value[i])
    }
    return ret;
  }

  //-U <globbing_expr>
  static #remove_variables()
  {
    const value = parser.getInput({key: 'remove_variables', type: 'array', required: false, default: [] , disableable: false })
    let ret=[]
    for(const i in value)
    {
      ret=ret.concat('-U',value[i])
    }
    return ret;
  }

  //-G <generator-name>
  static #generator()
  {
    let generator = parser.getInput({key: 'generator', type: 'string', required: false, default: '', disableable: false })
    if(generator!='')
    {
      this.#m_generator = generator
      return Array('-G',this.#m_generator)
    }
    else
    {
      this.#m_generator = this.#m_default_generator
      return Array()
    }
  }

  //-T <toolset-spec>
  static #toolset()
  {
    let has_toolset = true
    if(this.#m_capacities !== null)
    {
      for(let index in this.#m_capacities.generators)
      {
        let gen = this.#m_capacities.generators[index]
        if(gen.name == this.#m_generator)
        {
          has_toolset=gen.toolsetSupport
        }
      }
    }
    let toolset = parser.getInput({key: 'toolset', type: 'string', required: false, default: '', disableable: false })
    if(toolset!='')
    {
      if(has_toolset==false) core.warning('toolset is not needed')
      else return Array('-T',toolset)
    }
    return Array()
  }

  //-A <platform-name>
  static #platform()
  {
    let has_platform = true
    if(this.#m_capacities !== null)
    {
      for(let index in this.#m_capacities.generators)
      {
        let gen = this.#m_capacities.generators[index]
        if(gen.name == this.#m_generator)
        {
          has_platform=gen.platformSupport
        }
      }
    }
    let platform = core.getInput('platform', { required: false }) // don't use parser.getInput here !!!
    if(this.is_greater_equal('3.1'))
    {
      if(platform!='' && has_platform== true) return Array('-A',platform)
      else if(platform!='' && has_platform== false) core.warning('platform is not needed')
      return Array()
    }
    else
    {
      if(platform!='' && has_platform== true) return String(' '+platform)
      else if(platform!='' && has_platform== false )core.warning('platform is not needed')
      return String('')
    }
  }

  //--toolchain <path-to-file>
  static #toolchain()
  {
    let toolchain = parser.getInput({key: 'toolchain', type: 'string', required: false, default: '', disableable: false })
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
    let install_prefix = parser.getInput({key: 'install_prefix', type: 'string', required: false, default: '', disableable: false })
    if(install_prefix!='')
    {
      install_prefix=path.resolve(install_prefix)
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
      let project_file = parser.getInput({key: 'project_file', type: 'string', required: false, default: '', disableable: false })
      if(project_file!='')
      {
        return Array('--project-file',project_file)
      }
    }
    return Array()
  }

  /*static async #determineDefaultGenerator()
  {
    console.log(os_is())
    switch(os_is())
    {
      case "linux":
      {
        this.#m_default_generator = 'Unix Makefiles'
        break
      }
      case "darwin":
      {
        if(!this.is_greater_equal('3.3')) this.#m_default_generator = 'Unix Makefiles'
        else
        {
          this.#m_default_generator = 'Xcode'
          if(!this.is_greater_equal('3.22') && process.env.SDKROOT===undefined)
          {
            let cout = ''
            let cerr = ''
            const options = {};
            options.failOnStdErr = false
            options.ignoreReturnCode = true
            options.listeners =
            {
              stdout: (data) => { cout += data.toString() },
              stderr: (data) => { cerr += data.toString() },
            }
            options.silent = true
            await exec.exec('xcrun', ['--show-sdk-path'],options)
            process.env.SDKROOT=cout.replace('\n','').trim()
            cout = ''
            cerr = ''
            await exec.exec('xcrun', ['--find','clang'],options)
            cout=cout.replace('\n','').trim()
            let CC = cout
            let CXX = String(cout + '++')
            this.#m_default_cc_cxx=[`-DCMAKE_C_COMPILER:PATH=${CC}`,`-DCMAKE_CXX_COMPILER:PATH=${CXX}`]
            console.log(process.env.SDKROOT)
          }
        }
        break
      }
      case "win32":
      {
        if(this.#m_generators.includes('Visual Studio 17 2022')) this.#m_default_generator = 'Visual Studio 17 2022'
        else this.#m_default_generator = 'NMake Makefiles'
        // Read CC CXX
        if(process.env.CC !== undefined && (process.env.CC.includes('gcc')||process.env.CC.includes('clang')))
        {
          this.#m_default_generator = 'Unix Makefiles'
        }
        if(process.env.CXX !== undefined && (process.env.CXX.includes('g++')||process.env.CXX.includes('clang++')))
        {
          this.#m_default_generator = 'Unix Makefiles'
        }
        break
      }
      case "msys":
      case "ucrt64":
      case "clang64":
      case "clangarm64":
      case "mingw64":
      case "clang32":
      case "mingw32":
      {
        this.#m_default_generator = "Unix Makefiles"
        break
      }
      case "cygwin":
      {
        this.#m_default_generator = "Unix Makefiles"
        break
      }

    }
  }*/


  static async configure()
  {
    let command = []
    command=command.concat(this.#initial_cache())
    command=command.concat(this.#variables())
    command=command.concat(this.#remove_variables())
    if(!this.is_greater_equal('3.1'))
    {
      let gen = this.#generator()
      if(gen.length>0)
      {
        command=command.concat(this.#generator()[0])
        command=command.concat(this.#generator()[1]+this.#platform())
      }
    }
    else command=command.concat(this.#generator())
    command=command.concat(this.#toolset())
    if(this.is_greater_equal('3.1'))command=command.concat(this.#platform())
    command=command.concat(this.#toolchain())
    command=command.concat(this.#install_prefix())
    command=command.concat(this.#project_file())
    command=command.concat(this.#build_dir())
    command=command.concat(this.#source_dir()) // Must be the last one
    console.log(command)
    let cout = ''
    let cerr = ''
    const options = {};
    options.silent = false
    options.failOnStdErr = false
    options.ignoreReturnCode = true
    options.listeners =
    {
      stdout: (data) => { cout += data.toString() },
      stderr: (data) => { cerr += data.toString() },
      errline: (data) => {console.log(data) },
    }
    options.cwd = this.#working_directory()
    console.log(`Running CMake v${this.version()} in configure mode with generator ${this.#m_generator} (Default generator : ${this.default_generator()})`)
    if(this.#m_platforms.get(this.#m_generator) !== undefined && this.#m_platforms.get(this.#m_generator).length !=0) console.log(`Platform know to be available ${this.#m_platforms.get(this.#m_generator).toString()}`)
    let ret = await run('cmake',command,options)
    if(ret!=0) core.setFailed(cerr)
  }






  static #config_build()
  {
    let config = parser.getInput({key: 'config', type: 'string', required: false, default: process.env.config != '' ? process.env.config : '' , disableable: false })
    if(config!='')
    {

    }
    return Array()
  }

  static async build()
  {
    let command = ['--build',process.env.binary_dir]
    console.log(command)
    let cout = ''
    let cerr = ''
    const options = {};
    options.silent = false
    options.failOnStdErr = false
    options.ignoreReturnCode = true
    options.listeners =
    {
      stdout: (data) => { cout += data.toString() },
      stderr: (data) => { cerr += data.toString() },
      errline: (data) => {console.log(data) },
    }
    console.log(`Running CMake v${this.version()} in build mode`)
    let ret = await run('cmake',command,options)
    if(ret!=0) core.setFailed(cerr)
  }

  static #config_install()
  {
    let config = parser.getInput({key: 'config', type: 'string', required: false, default: process.env.config !== undefined ? process.env.config : 'Debug' , disableable: false })
    return Array('--config',config)
  }

  static async install()
  {
    let command = []
    if(this.is_greater_equal('3.15.0'))
    {
      command=['--install',process.env.binary_dir]
    }
    command=command.concat(this.#config_install())
    if(!this.is_greater_equal('3.15.0'))
    {
      command=['-P',process.env.binary_dir+'/cmake_install.cmake']
    }
    console.log(command)
    let cout = ''
    let cerr = ''
    const options = {};
    options.silent = false
    options.failOnStdErr = false
    options.ignoreReturnCode = true
    options.listeners =
    {
      stdout: (data) => { cout += data.toString() },
      stderr: (data) => { cerr += data.toString() },
      errline: (data) => {console.log(data) },
    }
    console.log(`Running CMake v${this.version()} in install mode`)
    let ret = await run('cmake',command,options)
    if(ret!=0) core.setFailed(cerr)
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
    const msys = path.join(tmp_dir, 'setup-msys2/msys2.cmd')
    let quotedArgs = [cmd].concat(args)
    //quotedArgs =  quotedArgs.map((arg) => {return `'${arg.replace(/'/g, `'\\''`)}'`}) // fix confused vim syntax highlighting with:
    return await exec.exec('cmd', ['/D', '/S', '/C', msys].concat(['-c', quotedArgs.join(' ')]), opts)
  }
  else return await exec.exec(cmd,args,opts)
}

async function runGraphviz()
{
  let command
  if(process.platform === "win32") command = 'dot.exe'
  else command= 'dot'
  let graphviz = core.getInput('graphviz', { required: false, default:'' });
  graphviz=path.resolve(graphviz)
  let params = ['-Tpng','-o', './toto.png',graphviz]
  let cout ='';
  let cerr='';
  const options = {};
  options.listeners = {
    stdout: (data) => {
      cout = data.toString();
    },
    stderr: (data) => {
      cerr = data.toString();
    }
  }
  await run(command,params, options)
  const {id, size} = await artifact.create().uploadArtifact(
    // name of the artifact
    'CMake dependencies',
    // files to include (supports absolute and relative paths)
    ['/home/runner/work/run-cmake/run-cmake/dependencies.dot'],
    {
      // optional: how long to retain the artifact
      // if unspecified, defaults to repository/org retention settings (the limit of this value)
      retentionDays: 10
    }
  )
  core.summary.addImage('toto.png', 'alt description of img', {width: '100', height: '100'})
  core.summary.write()
}

async function installGraphviz()
{
  let found_graphviz = false
  if(process.platform === "win32")
  {
    if(process.env.MSYSTEM !== undefined) found_graphviz = which.sync('dot', { nothrow: true })
    else found_graphviz = which.sync('dot.exe', { nothrow: true })
  }
  else
  {
    found_graphviz = which.sync('dot', { nothrow: true })
  }
  if(!found_graphviz)
  {
    let cout ='';
    let cerr='';
    const options = {};
    options.listeners = {
      stdout: (data) => {
        cout = data.toString();
      },
      stderr: (data) => {
        cerr = data.toString();
      }
    }
    let params = []
    let command
    let os = await os_is()
    /* cygwin doesn't have graphviz so install the windows one */
    if( os == "win32" || os == "cygwin" )
    {
      params = ['install', 'graphviz']
      command = 'choco'
    }
    else if( os == "msys2")
    {
      params = ['-S', 'graphviz:p']
      command = 'pacboy'
    }
    else if( os == "darwin")
    {
      params = ['install', 'graphviz']
      command = 'brew'
    }
    else
    {
      params = ['apt-get','install', 'graphviz']
      command = 'sudo'
    }
    core.info('Installing Graphviz')
    await run(command,params, options)
  }
  return true
}

class CommandLineMaker
{
  constructor()
  {
    this.m_error=false;
    if(CMakeVersionGreaterEqual('3.13.0')) this.old_style=false
    else this.old_style=true
    this.actual_path=path.resolve('./')
    //this.#binary_dir()
    //this.need_to_install_graphviz=this.#graphviz()
  }

  /* Configure */
   #configure_warnings()
  {
    let configure_warnings = core.getInput('configure_warnings', { required: false, default:'none' });
    if(configure_warnings=='') return []
    if(configure_warnings=='none')
    {
      return Array('-Wno-dev')
    }
    else if(configure_warnings=='deprecated')
    {
      if(! CMakeVersionGreaterEqual('3.5')) return Array('-Wdev')
      else return Array('-Wno-dev','-Wdeprecated')
    }
    else if(configure_warnings=='warning')
    {
      if(! CMakeVersionGreaterEqual('3.5')) return Array('-Wdev')
      else return Array('-Wdev','-Wno-deprecated')
    }
    else if(configure_warnings=='developer')
    {
      return Array('-Wdev')
    }
    else throw String('configure_warnings should be : none, deprecated, warning or developer. Received : '+configure_warnings)
  }

   #configure_warnings_as_errors()
  {
    let configure_warnings_as_errors = core.getInput('configure_warnings_as_errors', { required: false, default:'none' });
    if(configure_warnings_as_errors=='') return []
    if(configure_warnings_as_errors=='none')
    {
      if(! CMakeVersionGreaterEqual('3.5')) return []
      else return Array('-Wno-error=dev')
    }
    else if(configure_warnings_as_errors=='deprecated')
    {
      if(! CMakeVersionGreaterEqual('3.5')) return []
      else return Array('-Wno-error=dev','-Werror=deprecated')
    }
    else if(configure_warnings_as_errors=='warning')
    {
      if(! CMakeVersionGreaterEqual('3.5')) return []
      else return Array('-Werror=dev','-Wno-error=deprecated')
    }
    else if(configure_warnings_as_errors=='developer')
    {
      return Array('-Werror=dev')
    }
    else throw String('configure_warnings_as_errors should be : none, deprecated, warning or developer. Received : '+configure_warnings_as_errors)
  }

   #fresh()
  {
    return []
  }

   #list_cache_variables()
  {
    let list_cache_variables = core.getInput('list_cache_variables', { required: false, default:'' });
    if(list_cache_variables=='') return []
    else if(list_cache_variables=='cache') return Array('-L')
    else if(list_cache_variables=='cache_help') return Array('-LH')
    else if(list_cache_variables=='advanced') return Array('-LA')
    else if(list_cache_variables=='advanced_help') return Array('-LAH')
    else if(list_cache_variables=='off') return []
    else throw String('list_cache_variables should be : cache, cache_help, advanced or advanced_help. Received : '+list_cache_variables)
  }

   #graphviz()
  {
    let graphviz = core.getInput('graphviz', { required: false, default:'' });
    if(graphviz=='')
    {
      this.install_graphviz=false;
      return []
    }
    else
    {
      this.install_graphviz=true;
      graphviz=path.resolve(graphviz)
      return Array('--graphviz='+graphviz)
    }
  }

   #log_level()
  {
    let log_level = core.getInput('log_level', { required: false, default:'' });
    if(log_level!='')
    {
      if(log_level!='ERROR' && log_level!='WARNING' && log_level!='NOTICE' && log_level!='STATUS' && log_level!='VERBOSE' && log_level!='DEBUG' && log_level!='TRACE') throw String('log_level should be : ERROR, WARNING, NOTICE, STATUS, VERBOSE, DEBUG, TRACE. Received : '+log_level)
      if( CMakeVersionGreaterEqual('3.15')) return ['--log-level='+log_level]
    }
    return []
  }

   #log_context()
  {
    let log_level = core.getInput('log_level', { required: false, type: 'boolean',default:'' });
    if(log_level)
    {
      if( CMakeVersionGreaterEqual('3.17')) return ['--log-context']
      else return []
    }
    return []
  }


   #binary_build_dir()
  {
    this.binary_dir = process.env.binary_dir;
    if(this.binary_dir=='') this.binary_dir = core.getInput('binary_dir', { required: false, default: '../toto' });
    this.binary_dir=path.resolve(this.binary_dir)
    return Array(this.binary_dir)
  }

   #parallel()
  {
    if(! CMakeVersionGreaterEqual('3.12.0')) return Array()
    let value = parser.getInput('parallel',{default:global.number_cpus})
    value = parseInt(value, 10)
    if(isNaN(value)||value<=0) throw String('parallel should be a number >=1 ('+String(value)+')')
    return Array('--parallel',String(value))
  }

   #build_targets() /* FIXME for CMAKE<3.15 */
  {
    const build_targets = parser.getInput('build_targets', {type: 'array',default:[]})
    let targets= []
    if (build_targets.length == 0) return targets;
    else if( CMakeVersionGreaterEqual('3.15'))
    {
      let ret=['--target']
      for(const i in build_targets)
      {
        ret=ret.concat(build_targets[i])
      }
      targets.push(ret)
      return targets;
    }
    else
    {
      for(const i in build_targets)
      {
        let ret=[]
        ret=ret.concat('--target',build_targets[i])
        targets.push(ret)
      }
      return targets;
    }
  }

   #config()
  {
    const config = core.getInput('config', { required: false, default: '' })
    if(config!='')
    {
      core.exportVariable('config',config)
      return Array('--config',config)
    }
    else return []
  }

   #clean_first()
  {
    const clean_first = core.getInput('clean_first', { required: false, type: 'boolean', default: '' })
    if(clean_first) return ['--clean-first']
    else return []
  }

   #resolve_package_references()
  {
    const resolve_package_references = core.getInput('resolve_package_references', { required: false, default: '' })
    if(resolve_package_references=='') return []
    else if(resolve_package_references!='on' && resolve_package_references=='off' && resolve_package_references=='only')
    {
      throw String('resolve_package_references should be on,off,only. Received: '+resolve_package_references)
    }
    else if( CMakeVersionGreaterEqual('3.23')) return ['--resolve-package-references='+resolve_package_references]
    else return []
  }

   #build_verbose()
  {
    delete process.env.VERBOSE;
    delete process.env.CMAKE_VERBOSE_MAKEFILE;
    const build_verbose = core.getInput('build_verbose', { required: false, type: 'boolean', default: false })
    if(build_verbose)
    {
      if( CMakeVersionGreaterEqual('3.14'))
      {
        return Array('--verbose')
      }
      else
      {
        process.env.VERBOSE="TRUE"
        process.env.CMAKE_VERBOSE_MAKEFILE="TRUE"
        return []
      }
    }
    return []
  }

   #to_native_tool()
  {
    const to_native_tool = parser.getInput('to_native_tool', {type: 'array',default:[]})
    if(to_native_tool.length == 0) return []
    else
    {
      let ret = ['--']
      ret=ret.concat(to_native_tool)
      return ret
    }
  }

   buildCommandParameters()
  {
    let targets = this.#build_targets()
    let commands = []
    if(targets.length ==0)
    {
      let parameters=['--build']
      parameters=parameters.concat(this.#binary_build_dir())
      parameters=parameters.concat(this.#parallel())
      parameters=parameters.concat(this.#build_targets())
      parameters=parameters.concat(this.#config())
      parameters=parameters.concat(this.#clean_first())
      parameters=parameters.concat(this.#resolve_package_references())
      parameters=parameters.concat(this.#build_verbose())
      parameters=parameters.concat(this.#to_native_tool())
      commands.push(parameters)
    }
    else
    {
      for(const i in targets)
      {
        let parameters=['--build']
        parameters=parameters.concat(this.#binary_build_dir())
        parameters=parameters.concat(this.#parallel())
        parameters=parameters.concat(targets[i])
        parameters=parameters.concat(this.#config())
        if(i==1)parameters=parameters.concat(this.#clean_first())
        parameters=parameters.concat(this.#resolve_package_references())
        parameters=parameters.concat(this.#build_verbose())
        parameters=parameters.concat(this.#to_native_tool())
        commands.push(parameters)
      }
    }
    return commands
  }

  /** install step */
   #install_config()
  {
    let config
    // Find the config from build first
    if(process.env.config) config = process.env.config
    else config = core.getInput('config', { required: false, default: '' })
    if(config!='')
    {
      core.exportVariable('config',config)
      if( CMakeVersionGreaterEqual('3.15.0')) return Array('--config',config)
      else return Array('-DBUILD_TYPE:STRING='+config)
    }
    else return []
  }

   #component()
  {
    const component = core.getInput('component', { required: false, default: '' })
    if(component!='')
    {
      if( CMakeVersionGreaterEqual('3.15.0')) return Array('--component',component)
      else return Array('-DCOMPONENT',component)
    }
    else return []
  }

   #default_directory_permissions()
  {
    const default_directory_permissions = core.getInput('default_directory_permissions', { required: false, default: '' })
    if(default_directory_permissions!='')
    {
      if( CMakeVersionGreaterEqual('3.19')) return Array('--default-directory-permissions',default_directory_permissions)
      else return []
    }
    else return []
  }

   #override_install_prefix()
  {
    const override_install_prefix = core.getInput('override_install_prefix', { required: false, default: '' })
    if(override_install_prefix!='')
    {
      if( CMakeVersionGreaterEqual('3.15')) return Array('--prefix',override_install_prefix)
      else return []
    }
    else return []
  }

   #strip()
  {
    const strip = core.getInput('strip', { required: false, type: 'boolean', default: false })
    if( CMakeVersionGreaterEqual('3.15'))
    {
      if(strip) return Array('--strip')
      else return []
    }
    else return []
  }

   #install_verbose()
  {
    delete process.env.VERBOSE;
    const install_verbose = core.getInput('install_verbose', { required: false, type: 'boolean', default: false })
    if(install_verbose)
    {
      if( CMakeVersionGreaterEqual('3.15'))
      {
        return Array('--verbose')
      }
      else
      {
        process.env.VERBOSE="TRUE"
        return []
      }
    }
    return []
  }

   installCommandParameters()
  {
    let parameters=[]
    if( CMakeVersionGreaterEqual('3.15.0'))
    {
      parameters=parameters.concat('--install')
      parameters=parameters.concat(this.#binary_build_dir())
      parameters=parameters.concat(this.#install_config())
      parameters=parameters.concat(this.#component())
      parameters=parameters.concat(this.#default_directory_permissions())
      parameters=parameters.concat(this.#override_install_prefix())
      parameters=parameters.concat(this.#strip())
      parameters=parameters.concat(this.#install_verbose())
    }
    else
    {
      parameters=parameters.concat(this.#install_config())
      parameters=parameters.concat(this.#component())
      parameters=parameters.concat(this.#default_directory_permissions())
      parameters=parameters.concat(this.#override_install_prefix())
      parameters=parameters.concat(this.#strip())
      parameters=parameters.concat(this.#install_verbose())
      parameters=parameters.concat('-P')
      parameters=parameters.concat(this.#binary_build_dir()+'/cmake_install.cmake')
    }
    return parameters
  }

   workingDirectory()
  {
    if(this.old_style==true)
    {
        return process.env.binary_dir
    }
    else
    {
      return this.actual_path
    }
  }

   InstallGraphvizNeeded()
  {
    return this.need_to_install_graphviz
  }
}

async function configure(command_line_maker)
{
  let params=command_line_maker.configureCommandParameters()
  let cout ='';
  let cerr='';
  const options = {};
  options.listeners = {
    stdout: (data) => {
      cout = data.toString();
    },
    stderr: (data) => {
      cerr = data.toString();
    }
  }
  options.silent = false
  options.cwd = command_line_maker.workingDirectory();
  await run('cmake',params, options)
  //if(command_line_maker.InstallGraphvizNeeded()) await runGraphviz()
  return true;
}

async function build(command_line_maker)
{
  let cout ='';
  let cerr='';
  const options = {};
  options.listeners = {
    stdout: (data) => {
      cout = data.toString();
    },
    stderr: (data) => {
      cerr = data.toString();
    }
  }
  options.silent = false
  let commands = command_line_maker.buildCommandParameters()
  for(const i in commands)
  {
    await run('cmake',commands[i], options)
  }
}

async function install(command_line_maker)
{
  let cout ='';
  let cerr='';
  const options = {};
  options.listeners = {
    stdout: (data) => {
      cout = data.toString();
    },
    stderr: (data) => {
      cerr = data.toString();
    }
  }
  options.silent = false
  await run('cmake',command_line_maker.installCommandParameters(), options)
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
        await cmake.configure()
        break
      }
      case 'build':
      {
        await cmake.build()
        break
      }
      case 'install':
      {
        await cmake.install()
        break
      }
      case 'all':
      {
        await cmake.configure()
        await cmake.build()
        await cmake.install()
        break
      }
    }
    //console.log(cmake.version())
    //console.log(cmake.generators())
    //let ret;
    //global.cmake_version = await getCMakeVersion()
    /*console.log(`Running CMake v${global.cmake_version}`)
    getCapabilities()

    let toto = await os_is()
    console.log(`OS ${toto}!`)
    if(process.env.MSYSTEM !== undefined)
    {
      global.msys2 = String('msys2')
      global.is_msys2 = true
    }
    else
    {
      global.msys2 = String('cmake')
      global.is_msys2 = false
    }
    const cmake_matcher = path.join(__dirname, "cmake.json");
    core.info('::add-matcher::' + cmake_matcher);
    if(os.availableParallelism === "function") global.number_cpus = String(os.availableParallelism())
    else global.number_cpus = 1;
    //let found = which.sync(global.msys2, { nothrow: true })
    //if(!found) throw String('not found: CMake')
    //global.capabilities = await getCapabilities()
    const command_line_maker = new CommandLineMaker()
    let mode = getMode()
    if(mode==='configure')
    {
      command_line_maker.configureCommandParameters()
      //console.log(`error ${command_line_maker.error()}`)
      //if(!command_line_maker.error()) await configure(command_line_maker)
      //if(command_line_maker.InstallGraphvizNeeded()) await installGraphviz()

    }
    else if(mode==='build')
    {
      await build(command_line_maker)
    }
    else if(mode==='install')
    {
      await install(command_line_maker)
    }
    else if(mode==='all')
    {
      await configure(command_line_maker)
      await build(command_line_maker)
      await install(command_line_maker)
    }*/
  }
  catch (error)
  {
    core.setFailed(error)
  }
}

main()

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
const style = require('ansi-styles');
require('dotenv').config();


function os_is()
{
  if(process.env.MSYSTEM === 'MSYS') return 'cygwin'
  else if (process.env.MSYSTEM === 'UCRT64' || process.env.MSYSTEM === 'CLANG64' || process.env.MSYSTEM === 'CLANGARM64' || process.env.MSYSTEM === 'MINGW64') return 'msys2'
  else return process.platform
}

class CMake
{
  static #m_version = '0';
  static #m_capacities = JSON.parse('{}')
  static #m_generators = Array()
  static #m_mode
  static #m_default_generator = ''
  static #m_default_cc_cxx = []
  static async init()
  {
    if(!process.env.cmake_version) await this.#infos()
    else this.#m_version=process.env.cmake_version
    await this.#determineDefaultGenerator()
    this.#parseMode()
    return this;
  }

  static is_greater_equal(version)
  {
    return compare_version.compare(this.#m_version, version, '>=')
  }

  static version() { return this.#m_version }

  static generators() { return this.#m_generators }

  static mode() { return this.#m_mode}

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
  }

  static #parseVersion(string)
  {
    if(this.#m_capacities.hasOwnProperty('version')) this.#m_version=this.#m_capacities.version.string.match(/\d\.\d[\\.\d]+/)[0]
    else this.#m_version=string.match(/\d\.\d[\\.\d]+/)[0]
    core.exportVariable('cmake_version', this.#m_version);
  }

  static async #parseGenerators()
  {
    if(this.#m_capacities.hasOwnProperty('generators'))
    {
      for(var i= 0 ; i!= this.#m_capacities.generators.length; ++i)
      {
        this.#m_generators=this.#m_generators.concat(this.#m_capacities.generators[i].name)
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
      cout=cout.replace("*", " ");
      cout=cout.replace("\r", "");
      cout=cout.split("\n");
      for(const element of cout)
      {
        if(element.includes('='))
        {
          let gen=element.split("=");
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

  static async configure()
  {
    let command = []
    command=command.concat(this.#m_default_cc_cxx)
    command=command.concat(this.#build_dir())
    command=command.concat(this.#generator())
    console.log(`tototo ${process.env.SDKROOT}`)
    //command=command.concat(['-DCMAKE_C_COMPILER=/Applications/Xcode_15.4.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang','-DCMAKE_CXX_COMPILER=/Applications/Xcode_15.4.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++'])
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
      stdline: (data) => { console.log(data)},
      errline: (data) => { },
    }
    options.silent = true
    options.cwd = this.#working_directory()
    let ret = await run('cmake',command,options)
    if(ret!=0) core.setFailed(cerr)
  }

  // Before CMake 3.13 -B -S is not available so we need to run cmake in the binary folder in config mode
  static #working_directory()
  {
    if(this.is_greater_equal('3.13')) return path.resolve('./')
    else return process.env.binary_dir
  }

  static #build_dir()
  {
    let binary_dir = parser.getInput({key: 'binary_dir', type: 'string', required: false, default: '../build', disableable: false })
    binary_dir=path.resolve(binary_dir)
    core.exportVariable('binary_dir', binary_dir);
    if(this.is_greater_equal('3.13')) return Array('-B',binary_dir)
    else
    {
      io.mkdirP(binary_dir)
      return Array()
    }
  }

  static #source_dir()
  {
    let source_dir = parser.getInput({key: 'source_dir', type: 'string', required: false, default: process.env.GITHUB_WORKSPACE ? process.env.GITHUB_WORKSPACE : './' , disableable: false });
    source_dir=path.resolve(source_dir)
    if(this.is_greater_equal('3.13')) return Array('-S',source_dir)
    else return Array(source_dir)
  }

  static async #determineDefaultGenerator()
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
          process.env.SDKROOT=cout
          cout = ''
          cerr = ''
          await exec.exec('xcrun', ['--find','clang'],options)
          cout=cout.replace('\n','')
          let CC = cout
          let CXX = String(cout + '++')
          this.#m_default_cc_cxx=[`-DCMAKE_C_COMPILER:PATH=${CC}`,`-DCMAKE_CXX_COMPILER:PATH=${CXX}`]
          console.log(process.env.SDKROOT)
        }
        break
      }
      case "win32":
      {
        if(this.#m_generators.includes('Visual Studio 17 2022')) this.#m_default_generator = 'Visual Studio 17 2022'
        else this.#m_default_generator = 'NMake Makefiles'
        break
      }
    }
  }

  static #generator()
  {
    if(this.#m_default_generator!='') return Array('-G',this.#m_default_generator)
    else return Array()
  }

  static async build()
  {

  }

  static async install()
  {

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


function CMakeVersionGreaterEqual(version)
{
  return compare_version.compare(global.cmake_version, version, '>=')
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

function kill(error)
{
   core.setFailed(error)
   process.exit(core.ExitCode.Failure)
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
   #source_dir()
  {
    let source_dir = core.getInput('source_dir', { required: false, default: '' });
    if(source_dir=='')
    {
      source_dir = process.env.GITHUB_WORKSPACE;
      if(source_dir === undefined) source_dir='./'
    }
    source_dir=path.resolve(source_dir)
    if(!this.old_style) return Array('-S',source_dir)
    else return Array(source_dir)
  }

   #binary_dir()
  {
    this.binary_dir = core.getInput('binary_dir', { required: false, default: '../build' });
    this.binary_dir=path.resolve(this.binary_dir)
    core.exportVariable('binary_dir', this.binary_dir);
    if(!this.old_style) return Array('-B',this.binary_dir)
    else
    {
      io.mkdirP(this.binary_dir);
      return Array()
    }
  }

   #initial_cache()
  {
    let initial_cache = core.getInput('initial_cache', { required: false })
    if(initial_cache!='')
    {
      initial_cache=path.posix.resolve(initial_cache)
      return Array('-C',initial_cache)
    }
    else return Array()
  }

   #variables()
  {
    const value = parser.getInput('variables', {type: 'array',default:[]})
    let ret=[]
    for(const i in value)
    {
      ret=ret.concat('-D',value[i])
    }
    return ret;
  }

   #remove_variables()
  {
    const value = parser.getInput('remove_variables', {type: 'array',default:[]})
    let ret=[]
    for(const i in value)
    {
      ret=ret.concat('-U',value[i])
    }
    return ret;
  }
  error()
  {
    return this.m_error;
  }
  #generator()
  {
    //console.log("Here11")
    this.generator = core.getInput('generator', { required: false });
    //if(this.generator=='')
    //{
     //   if(process.platform === "win32") this.generator="NMake Makefiles"
        /*else*/
    //}
    /*this.#parseListGenerator().then((gens)=>{
      console.log(gens)
      console.log(this.generator)
      let generator="Unix Makefiles"
      if(gens.includes(generator))
      {

        let gen = '['+gens.toString()+']'
        throw String('Generator '+generator+' is not supported by CMake '+global.cmake_version+'. Accepted ones are : '+gen)
      }
    }).catch((error)=>{console.log(error)})*/

      if(!CMakeVersionGreaterEqual('3.1.0'))
      {
        this.#platform() /** TODO fix this mess dude */
        if(this.platform!='')this.generator=this.generator+' '+this.platform
      }
      this.generator = Array('-G',this.generator)
      return false;
  }

  #toolset()
  {
    this.toolset = core.getInput('toolset', { required: false })
    if(this.toolset!='' && CMakeVersionGreaterEqual('3.1.0')) return Array('-T',this.toolset)
    else return Array()
  }

  /* Must be called before generator to allow to add the toolset to the generator string !!!*/
   #platform()
  {
    this.platform = core.getInput('platform', { required: false })
    /* CMake 3.0 only allow platform to be addind to the generator string */
    if(! CMakeVersionGreaterEqual('3.1.0')) return Array()
    if(this.platform!='') return Array('-A',this.platform)
    else return Array()
  }

  #toolchain()
  {
    delete process.env.CMAKE_TOOLCHAIN_FILE;
    let toolchain = core.getInput('toolchain', { required: false })
    if(toolchain!='')
    {
      if(CMakeVersionGreaterEqual('3.21.0')) return Array('--toolchain',toolchain)
      else return Array('-DCMAKE_TOOLCHAIN_FILE:PATH='+toolchain)
    }
    return []
  }

  #install_prefix()
  {
    delete process.env.CMAKE_INSTALL_PREFIX;
    this.install_prefix = core.getInput('install_prefix', { required: false, default:'' });
    if(this.install_prefix!='')
    {
      //if(process.env.MSYS2_LOCATION)this.install_prefix=path.resolve('/usr/local/',this.install_prefix)
      this.install_prefix=path.resolve(this.install_prefix)
      if(CMakeVersionGreaterEqual('3.21.0')) return Array('--install-prefix',this.install_prefix)
      else return Array('-DCMAKE_INSTALL_PREFIX:PATH='+this.install_prefix)
    }
    return []
  }

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

  configureCommandParameters()
  {
    let ret = true
    let options=[]

    options=options.concat(this.#binary_dir())
    // First check is initial_cache file exist
    /*const initial_cache = this.#initial_cache()
    if(Array.isArray(initial_cache) && initial_cache.length !== 0)
    {
      options=options.concat(initial_cache)
    }
    options=options.concat(this.#remove_variables())
    options=options.concat(this.#variables())*/
    //console.log("Here1")
    this.#generator()
    options=options.concat(this.generator)
    //console.log(this.m_error)
    //console.log("Here2")
    /*options=options.concat(this.#toolset())
    options=options.concat(this.#platform())
    options=options.concat(this.#toolchain())
    options=options.concat(this.#install_prefix())
    options=options.concat(this.#configure_warnings())
    options=options.concat(this.#configure_warnings_as_errors())
    options=options.concat(this.#fresh())
    options=options.concat(this.#list_cache_variables())
    options=options.concat(this.#graphviz())
    options=options.concat(this.#log_level())
    options=options.concat(this.#log_context())
*/
    options=options.concat(this.#source_dir()) // Need to be the last
    //console.log(options)
    return options
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
    console.log(`Running CMake v${cmake.version()} in ${cmake.mode()} mode`)
    switch(cmake.mode())
    {
      case 'configure':
      {
        cmake.configure()
        console.log(cmake.generators())
        break
      }
      case 'build':
      {
        cmake.build()
        break
      }
      case 'install':
      {
        cmake.install()
        break
      }
      case 'all':
      {
        cmake.configure()
        cmake.build()
        cmake.install()
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

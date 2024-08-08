const core = require('@actions/core');
const exec = require('@actions/exec');
const which = require('which')
const compare_version = require('compare-versions')
const io = require('@actions/io');
const path = require('path')
const parser = require('action-input-parser')
const semver = require('semver')
const os = require("node:os");

async function fixes()
{
  const options = {};
  options.silent = true
  if(process.platform === "linux")
  {
    await exec.exec('sudo apt-get update', [], options)
    await exec.exec('sudo apt-get install --no-install-recommends -y libidn12', [], options)
    await exec.exec('sudo ln -sf /usr/lib/x86_64-linux-gnu/libidn.so.12 /usr/lib/x86_64-linux-gnu/libidn.so.11', [], options)
    await exec.exec("mkdir -p /home/runner/.ssh", [], options)
    await exec.exec("touch  /home/runner/.ssh/known_hosts", [], options)
    await exec.exec("/bin/bash -c \"curl -L https://api.github.com/meta | jq -r '.ssh_keys | .[]' | sed -e 's/^/github.com /' >> /home/runner/.ssh/known_hosts\"", [], options)
  }
  else if(process.platform === "darwin")
  {
    await exec.exec("mkdir -p /Users/runner/.ssh", [], options)
    await exec.exec("touch  /Users/runner/.ssh/known_hosts", [], options)
    await exec.exec("/bin/bash -c \"curl -L https://api.github.com/meta | jq -r '.ssh_keys | .[]' | sed -e 's/^/github.com /' >> /Users/runner/.ssh/known_hosts\"", [], options)
  }
}

/**
 * @param {string[]} args
 * @param {object} opts
 */
async function run(cmd,args, opts)
{
  if(global.msys)
  {
    const tmp_dir = process.env['RUNNER_TEMP'];
    if(!tmp_dir) {
      core.setFailed('environment variable RUNNER_TEMP is undefined');
      return;
    }
    const msys = path.join(tmp_dir, 'setup-msys2/msys2.cmd');
    const quotedArgs = [cmd].concat(args)
    quotedArgs =  args.map((arg) => {return `'${arg.replace(/'/g, `'\\''`)}'`}); // fix confused vim syntax highlighting with:
    await exec.exec('cmd', ['/D', '/S', '/C', msys].concat(['-c', quotedArgs.join(' ')]), opts);
  }
  else await exec.exec(cmd,args,opts)
}

async function getCMakeVersion()
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
  await run('cmake',['--version'],options)
  let version_number = cout.match(/\d\.\d[\\.\d]+/)
  if (version_number.length === 0 || version_number === null) throw String('Failing to parse CMake version')
  else return version_number[0]
}

async function getCapabilities()
{
  if(CMakeVersionGreaterEqual('3.7'))
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
    options.silent = true
    if(global.is_msys2) options.shell = 'msys2'
    run('cmake',['-E','capabilities'], options)
    return JSON.parse(cout);
  }
  else return '{}'
}


function CMakeVersionGreaterEqual(version)
{
  return compare_version.compare(global.cmake_version, version, '>=')
}

async function installGraphviz()
{
  let found_graphviz = false
  if(process.platform === "win32")
  {
    found_graphviz = which.sync('dot.exe', { nothrow: true })
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
    options.silent = true
  }
}

class CommandLineMaker
{
  constructor()
  {
    if(CMakeVersionGreaterEqual('3.13.0')) this.old_style=false
    else this.old_style=true
    this.actual_path=path.resolve('./')
    this.#binary_dir()
    this.need_to_install_graphviz=this.#graphviz()
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
    this.binary_dir = core.getInput('binary_dir', { required: false, default: "../build" });
    this.binary_dir=path.posix.resolve(this.binary_dir)
    core.exportVariable('binary_dir',this.binary_dir)
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

  #generator()
  {
    this.generator = core.getInput('generator', { required: false });
    if(this.generator=='')
    {
      if(process.platform === "win32") this.generator="NMake Makefiles"
      else this.generator="Unix Makefiles"
    }
    else
    {
      let generators = this.#getGeneratorList()
      if(!generators.includes(this.generator))
      {
        let gen = String('[')
        for(const i in generators) { gen+=generators[i]+',' }
        gen = gen.substring(0, gen.length - 1);
        gen+=']'
        throw String('Generator '+this.generator+' is not supported by CMake '+global.cmake_version+'. Accepted ones are : '+gen)
      }
    }
    if(!CMakeVersionGreaterEqual('3.1.0'))
    {
      this.#platform() /** TODO fix this mess dude */
      if(this.platform!='')this.generator=this.generator+' '+this.platform
    }
    return Array('-G',this.generator)
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
    if(!CMakeVersionGreaterEqual('3.1.0')) return Array()
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
      else return Array('-DCMAKE_TOOLCHAIN_FILE:PATH='+install_prefix)
    }
    return []
  }

  #install_prefix()
  {
    delete process.env.CMAKE_INSTALL_PREFIX;
    this.install_prefix = core.getInput('install_prefix', { required: false, default:'' });
    if(this.install_prefix!='')
    {
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
      if(!CMakeVersionGreaterEqual('3.5')) return Array('-Wdev')
      else return Array('-Wno-dev','-Wdeprecated')
    }
    else if(configure_warnings=='warning')
    {
      if(!CMakeVersionGreaterEqual('3.5')) return Array('-Wdev')
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
      if(!CMakeVersionGreaterEqual('3.5')) return []
      else return Array('-Wno-error=dev')
    }
    else if(configure_warnings_as_errors=='deprecated')
    {
      if(!CMakeVersionGreaterEqual('3.5')) return []
      else return Array('-Wno-error=dev','-Werror=deprecated')
    }
    else if(configure_warnings_as_errors=='warning')
    {
      if(!CMakeVersionGreaterEqual('3.5')) return []
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
      if(CMakeVersionGreaterEqual('3.15')) return ['--log-level='+log_level]
    }
    return []
  }

  #log_context()
  {
    let log_level = core.getInput('log_level', { required: false, type: 'boolean',default:'' });
    if(log_level)
    {
      if(CMakeVersionGreaterEqual('3.17')) return ['--log-context']
      else return []
    }
    return []
  }

  configureCommandParameters() 
  {
    let options=[]

    options=options.concat(this.#binary_dir())
    // First check is initial_cache file exist
    const initial_cache = this.#initial_cache()
    if(Array.isArray(initial_cache) && initial_cache.length !== 0)
    {
      options=options.concat(initial_cache)
    }
    options=options.concat(this.#remove_variables())
    options=options.concat(this.#variables())
    options=options.concat(this.#generator())
    options=options.concat(this.#toolset())
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

    options=options.concat(this.#source_dir()) // Need to be the last
    return options
  }


  #binary_build_dir()
  {
    return Array(process.env.binary_dir)
  }

  #parallel()
  {
    if(!CMakeVersionGreaterEqual('3.12.0')) return Array()
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
    else if(CMakeVersionGreaterEqual('3.15'))
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
    else if(CMakeVersionGreaterEqual('3.23')) return ['--resolve-package-references='+resolve_package_references]
    else return []
  }

  #build_verbose()
  {
    delete process.env.VERBOSE;
    delete process.env.CMAKE_VERBOSE_MAKEFILE;
    const build_verbose = core.getInput('build_verbose', { required: false, type: 'boolean', default: false })
    if(build_verbose)
    {
      if(CMakeVersionGreaterEqual('3.14'))
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
      ret.concat(to_native_tool)
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
      if(CMakeVersionGreaterEqual('3.15.0')) return Array('--config',config)
      else return Array('-DBUILD_TYPE:STRING='+config)
    }
    else return []
  }

  #component()
  {
    const component = core.getInput('component', { required: false, default: '' })
    if(component!='')
    {
      if(CMakeVersionGreaterEqual('3.15.0')) return Array('--component',component)
      else return Array('-DCOMPONENT',component)
    }
    else return []
  }

  #default_directory_permissions()
  {
    const default_directory_permissions = core.getInput('default_directory_permissions', { required: false, default: '' })
    if(default_directory_permissions!='')
    {
      if(CMakeVersionGreaterEqual('3.19')) return Array('--default-directory-permissions',default_directory_permissions)
      else return []
    }
    else return []
  }

  #override_install_prefix()
  {
    const override_install_prefix = core.getInput('override_install_prefix', { required: false, default: '' })
    if(override_install_prefix!='')
    {
      if(CMakeVersionGreaterEqual('3.15')) return Array('--prefix',override_install_prefix)
      else return []
    }
    else return []
  }

  #strip()
  {
    const strip = core.getInput('strip', { required: false, type: 'boolean', default: false })
    if(CMakeVersionGreaterEqual('3.15'))
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
      if(CMakeVersionGreaterEqual('3.15'))
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
    if(CMakeVersionGreaterEqual('3.15.0'))
    {
      parameters=parameters.concat('--install')
      parameters=parameters.concat(process.env.binary_dir)
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
      parameters=parameters.concat(process.env.binary_dir+'/cmake_install.cmake')
    }
    return parameters
  }

  workingDirectory()
  {
    if(this.old_style==true) return this.binary_dir
    else return this.actual_path
  }

  #getGeneratorList()
  {
    if(process.platform === "win32")
    {
      const myMap = new Map([
        ['3.0', ['Borland Makefiles','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 6','Visual Studio 7','Visual Studio 7 .NET 2003','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Watcom WMake']],
        ['3.1', ['Borland Makefiles','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 6','Visual Studio 7','Visual Studio 7 .NET 2003','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Watcom WMake']],
        ['3.2', ['Borland Makefiles','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 6','Visual Studio 7','Visual Studio 7 .NET 2003','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Watcom WMake']],
        /*Maybe add some */['3.3', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 6','Visual Studio 7','Visual Studio 7 .NET 2003','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Watcom WMake']],
        ['3.4', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 6','Visual Studio 7','Visual Studio 7 .NET 2003','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Watcom WMake']],
        ['3.5', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 6','Visual Studio 7','Visual Studio 7 .NET 2003','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Watcom WMake']],
        ['3.6', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 7 .NET 2003','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Watcom WMake']],
        ['3.7', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 7 .NET 2003','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Watcom WMake']],
        ['3.8', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 7 .NET 2003','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Watcom WMake']],
        ['3.9', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Watcom WMake']],
        ['3.10', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Watcom WMake']],
        ['3.11', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 8 2005','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Watcom WMake']],
        ['3.12', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Watcom WMake']],
        ['3.13', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Watcom WMake']],
        ['3.14', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Watcom WMake']],
        ['3.15', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Watcom WMake']],
        ['3.16', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Watcom WMake']],
        ['3.17', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Watcom WMake']],
        ['3.18', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Watcom WMake']],
        ['3.19', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Watcom WMake']],
        ['3.20', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Watcom WMake']],
        ['3.21', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Visual Studio 17 2022','Watcom WMake']],
        ['3.22', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Visual Studio 17 2022','Watcom WMake']],
        ['3.23', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Visual Studio 17 2022','Watcom WMake']],
        ['3.24', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 10 2010','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Visual Studio 17 2022','Watcom WMake']],
        ['3.25', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Visual Studio 17 2022','Watcom WMake']],
        ['3.26', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Visual Studio 17 2022','Watcom WMake']],
        ['3.27', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 11 2012','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Visual Studio 17 2022','Watcom WMake']],
        ['3.28', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Visual Studio 17 2022','Watcom WMake']],
        ['3.29', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 9 2008','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Visual Studio 17 2022','Watcom WMake']],
        ['3.30', ['Borland Makefiles','Green Hills MULTI','MinGW Makefiles','MSYS Makefiles','Ninja','Ninja Multi-Config','NMake Makefiles','NMake Makefiles JOM','Unix Makefiles','Visual Studio 12 2013','Visual Studio 14 2015','Visual Studio 15 2017','Visual Studio 16 2019','Visual Studio 17 2022','Watcom WMake']],
      ]);
      let version=semver.major(global.cmake_version)+'.'+semver.minor(global.cmake_version)
      return myMap.get(version.toString());
    }
    else if(process.platform === "linux")
    {
      const myMap = new Map([
        ['3.0', ['Ninja','Unix Makefiles']],
        ['3.1', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.2', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.3', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.4', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.5', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.6', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.7', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.8', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.9', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.10', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.11', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.12', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.13', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.14', ['Ninja','Unix Makefiles','Watcom WMake']],
        ['3.15', ['Green Hills MULTI','Ninja','Unix Makefiles','Watcom WMake']],
        ['3.16', ['Green Hills MULTI','Ninja','Unix Makefiles','Watcom WMake']],
        ['3.17', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.18', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.19', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.20', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.21', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.22', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.23', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.24', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.25', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.26', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.27', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.28', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.29', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
        ['3.30', ['Green Hills MULTI','Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake']],
      ]);
      let version=semver.major(global.cmake_version)+'.'+semver.minor(global.cmake_version)
      return myMap.get(version.toString());
    }
    else
    {
      const myMap = new Map([
        ['3.0', ['Ninja','Unix Makefiles','Xcode']],
        ['3.1', ['Ninja','Unix Makefiles','Xcode']],
        ['3.2', ['Ninja','Unix Makefiles','Xcode']],
        ['3.3', ['Ninja','Unix Makefiles','Xcode']],
        ['3.4', ['Ninja','Unix Makefiles','Xcode']],
        ['3.5', ['Ninja','Unix Makefiles','Xcode']],
        ['3.6', ['Ninja','Unix Makefiles','Xcode']],
        ['3.7', ['Ninja','Unix Makefiles','Xcode']],
        ['3.8', ['Ninja','Unix Makefiles','Xcode']],
        ['3.9', ['Ninja','Unix Makefiles','Xcode']],
        ['3.10', ['Ninja','Unix Makefiles','Xcode']],
        ['3.11', ['Ninja','Unix Makefiles','Xcode']],
        ['3.12', ['Ninja','Unix Makefiles','Xcode']],
        ['3.13', ['Ninja','Unix Makefiles','Xcode']],
        ['3.14', ['Ninja','Unix Makefiles','Xcode']],
        ['3.15', ['Ninja','Unix Makefiles','Xcode']],
        ['3.16', ['Ninja','Unix Makefiles','Xcode']],
        ['3.17', ['Ninja','Ninja Multi-Config','Unix Makefiles','Xcode']],
        ['3.18', ['Ninja','Ninja Multi-Config','Unix Makefiles','Xcode']],
        ['3.19', ['Ninja','Ninja Multi-Config','Unix Makefiles','Xcode']],
        ['3.20', ['Ninja','Ninja Multi-Config','Unix Makefiles','Xcode']],
        ['3.21', ['Ninja','Ninja Multi-Config','Unix Makefiles','Xcode']],
        ['3.22', ['Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake','Xcode']],
        ['3.23', ['Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake','Xcode']],
        ['3.24', ['Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake','Xcode']],
        ['3.25', ['Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake','Xcode']],
        ['3.26', ['Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake','Xcode']],
        ['3.27', ['Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake','Xcode']],
        ['3.28', ['Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake','Xcode']],
        ['3.29', ['Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake','Xcode']],
        ['3.30', ['Ninja','Ninja Multi-Config','Unix Makefiles','Watcom WMake','Xcode']],
      ]);
      let version=semver.major(global.cmake_version)+'.'+semver.minor(global.cmake_version)
      return myMap.get(version.toString());
    }
  }

  InstallGraphvizNeeded()
  {
    return this.need_to_install_graphviz
  }
}

/* Detect which mode the user wants :
   - configure: CMake configure the project only.
   - build: CMake build the project only.
   - install: CMake install the project.
   - all: CMake configure, build and install in a row.
   By default CMake is in configure mode.
*/ 
function getMode()
{
  const mode = parser.getInput('mode', {type: 'string',default:'configure'})
  if(mode!='configure' && mode!='build' && mode!='install' && mode!='all') throw String('mode should be configure, build, install or all')
  return mode;
}

function configure(command_line_maker)
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
  options.cwd = command_line_maker.workingDirectory()
  run('cmake',command_line_maker.configureCommandParameters(), options)
}

function build(command_line_maker)
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
    run('cmake',commands[i], options)
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
  run('cmake',command_line_maker.installCommandParameters(), options)
}

async function main()
{
  try
  {
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
    else
    {
      let cpus = []
      cpus= os.cpus()
      global.number_cpus = String(cpus.length)
    }
    await fixes()
    //let found = which.sync(global.msys2, { nothrow: true })
    //if(!found) throw String('not found: CMake')
    global.cmake_version= await getCMakeVersion()
    //global.capabilities = await getCapabilities()
    const command_line_maker = new CommandLineMaker()
    if(command_line_maker.InstallGraphvizNeeded()) await installGraphviz()
    let mode = getMode()
    if(mode==='configure')
    {
      configure(command_line_maker)
    }
    else if(mode==='build')
    {
      build(command_line_maker)
    }
    else if(mode==='install')
    {
      install(command_line_maker)
    }
    else if(mode==='all')
    {
      configure(command_line_maker)
      build(command_line_maker)
      install(command_line_maker)
    }
  }
  catch (error)
  {
    core.setFailed(error)
  }
}

main()

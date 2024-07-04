const core = require('@actions/core');
const exec = require('@actions/exec');
const which = require('which')
const compare_version = require('compare-versions')
const io = require('@actions/io');
const path = require('path')
const {DefaultArtifactClient} = require('@actions/artifact')
const github = require('@actions/github');
const parser = require('action-input-parser')
const semver = require('semver')
const os = require("node:os");

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
  options.silent = true
  await exec.exec('cmake', ['--version'], options)
  let version_number = cout.match(/\d\.\d[\\.\d]+/)
  if (version_number.length === 0) throw String('Failing to parse CMake version')
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
    await exec.exec('cmake',['-E','capabilities'], options)
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
  if(process.platform === "win32") await exec.exec('choco',['install', 'graphviz'])
  else if(process.platform === "linux") await exec.exec('sudo apt-get',['install', 'graphviz'])
  else await exec.exec('brew', ['install', 'graphviz'])
}

class CommandLineMaker
{
  constructor()
  {
    if(CMakeVersionGreaterEqual('3.13.0')) this.old_style=false
    else this.old_style=true
    this.actual_path=path.resolve('./')
    this.#binary_dir()
  }

  #source_dir()
  {
    this.source_dir = core.getInput('source_dir', { required: false });
    if(this.source_dir=='')
    {
      this.source_dir = process.env.GITHUB_WORKSPACE;
      if(this.source_dir === undefined) this.source_dir='./'
    }
    this.source_dir=path.resolve(this.source_dir)
    if(this.old_style==false) return Array('-S',this.source_dir)
    else return Array(this.source_dir)
  }

  #binary_dir()
  {
    this.binary_dir = core.getInput('binary_dir', { required: false });
    if(this.binary_dir=='') this.binary_dir="./build"
    this.binary_dir=path.posix.resolve(this.binary_dir)
    core.exportVariable('binary_dir',this.binary_dir)
    if(this.old_style==false) return Array('-B',this.binary_dir)
    else
    {
      io.mkdirP(this.binary_dir);
      return Array()
    }
  }

  #binary_build_dir()
  {
    return Array(process.env.binary_dir)
  }

  #initial_cache()
  {
    this.initial_cache = core.getInput('initial_cache', { required: false })
    if(this.initial_cache!='')
    {
      this.initial_cache=path.posix.resolve(this.initial_cache)
      return Array('-C',this.initial_cache)
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

  #parallel()
  {
    if(!CMakeVersionGreaterEqual('3.12.0')) return Array()
    let nbrCores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
    let value = parser.getInput('parallel',{default:nbrCores})
    value = parseInt(value, 10)
    if(isNaN(value)||value<=0) throw String('parallel should be a number >=1 ('+String(value)+')')
    return Array('--parallel',String(value))
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

    options=options.concat(this.#source_dir()) // Need to be the last
    console.log(options)
    return options
  }

  buildCommandParameters()
  {
    let parameters=[]
    parameters=parameters.concat('--build') // Need to be the first
    parameters=parameters.concat(this.#binary_build_dir())
    parameters=parameters.concat(this.#parallel())
    console.log(parameters)
    return parameters
  }

  installCommandParameters()
  {
    let parameters=[]
    if(CMakeVersionGreaterEqual('3.15.0'))
    {
      parameters=parameters.concat('--install')
      parameters=parameters.concat(process.env.binary_dir)
      parameters=parameters.concat(this.#strip())
    }
    else
    {
      parameters=parameters.concat('-P')
      parameters=parameters.concat(process.env.binary_dir+'/cmake_install.cmake')
    }
    console.log(parameters)
    return parameters
  }

  workingDirectory()
  {
    if(this.old_style==true) return this.binary_dir
    else return this.actual_path
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
    return Array('-G',this.generator)
  }

  #toolset()
  {
    this.toolset = core.getInput('toolset', { required: false })
    if(this.toolset!='') return Array('-T',this.toolset)
    else return Array()
  }

  #platform()
  {
    this.platform = core.getInput('platform', { required: false })
    if(this.platform!='') return Array('-A',this.platform)
    else return Array()
  }

  #toolchain()
  {
    this.toolchain = core.getInput('toolchain', { required: false })
    if(this.toolchain!='') return Array('--toolchain',this.toolchain)
    else return Array()
  }

  #install_prefix()
  {
    delete process.env.CMAKE_INSTALL_PREFIX;
    this.install_prefix = core.getInput('install_prefix', { required: false });
    if(this.install_prefix!='')
    {
      this.install_prefix=path.resolve(this.install_prefix)
      if(CMakeVersionGreaterEqual('3.21.0')) return Array('--install-prefix',this.install_prefix)
      else return Array('-DCMAKE_INSTALL_PREFIX:PATH='+this.install_prefix)
    }
    return []
  }

  #strip()
  {
    const strip = core.getInput('strip', { required: false, type: 'boolean', default: false })
    if(strip) return Array('--strip')
    else return Array()
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
      let version=semver.major(global.cmake_version)+'.'+semver.major(global.cmake_version)
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
      let version=semver.major(global.cmake_version)+'.'+semver.major(global.cmake_version)
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
      let version=semver.major(global.cmake_version)+'.'+semver.major(global.cmake_version)
      return myMap.get(version.toString());
    }
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
  exec.exec('cmake',command_line_maker.configureCommandParameters(), options)
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
  exec.exec('cmake',command_line_maker.buildCommandParameters(), options)
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
  exec.exec('cmake',command_line_maker.installCommandParameters(), options)
}

async function main()
{
  try
  {
    let found = which.sync('cmake', { nothrow: true })
    if(!found) throw String('not found: CMake')
    global.cmake_version= await getCMakeVersion()
    global.capabilities = await getCapabilities()
    const command_line_maker = new CommandLineMaker()
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
    //await exec.exec('dot', ['-Tpng', '-o', png_file, dot_name])

    //core.summary.addImage('./toto.dot', 'alt description of img', {width: '100', height: '100'})
    //core.summary.write()

    //const artifact = new DefaultArtifactClient()
    //const {id, size} = await artifact.uploadArtifact(
    // name of the artifact
    //  'toto.dot',
    // files to include (supports absolute and relative paths)
    //  ['./png.png'],absolute,
    //  {
    // optional: how long to retain the artifact
    // if unspecified, defaults to repository/org retention settings (the limit of this value)
    //retentionDays: 1
    //  }
    // )
    //console.log(id)
    //${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}/artifacts/${{ steps.artifact-upload-step.outputs.artifact-id }}
    }
  catch (error)
  {
    core.setFailed(error)
  }
}

main()

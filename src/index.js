const core = require('@actions/core');
const exec = require('@actions/exec');
const which = require('which')
const compare_version = require('compare-versions')
const io = require('@actions/io');
const path = require('path')
const {DefaultArtifactClient} = require('@actions/artifact')
const github = require('@actions/github');

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

class commandLineMaker
{
  constructor()
  {
    if(CMakeVersionGreaterEqual('3.13.0')) this.old_style=false
    else this.old_style=true
    this.actual_path=path.resolve('./')
  }

  #source_dir()
  {
    this.source_dir = core.getInput('source_dir', { required: false });
    if(this.source_dir=='')
    {
      this.source_dir = process.env.GITHUB_WORKSPACE;
      if(this.source_dir === undefined) this.source_dir="./"
    }
    this.source_dir=path.resolve(this.source_dir)
    if(this.old_style==false) return Array('-S',this.source_dir)
    else return Array(this.source_dir)
  }

  #binary_dir()
  {
    this.binary_dir = core.getInput('binary_dir', { required: false });
    if(this.binary_dir=='') this.binary_dir="./build"
    this.binary_dir=path.resolve(this.binary_dir)
    if(this.old_style==false) return Array('-B',this.binary_dir)
    else
    {
      io.mkdirP(this.binary_dir);
      return Array()
    }
  }

  #variables_before_initial_cache()
  {
    this.variables_before_initial_cache = core.getInput('variables_before_initial_cache', { required: false })
    if(this.variables_before_initial_cache =='') return Array()
    else return Array(this.variables_before_initial_cache)
  }

  #initial_cache()
  {
    this.initial_cache = core.getInput('initial_cache', { required: false })
    if(this.initial_cache!='') return Array('-C',this.initial_cache)
    else return Array()
  }





  buildArray() 
  {
    let options=[]

    options=options.concat(this.#binary_dir())
    options=options.concat(this.#variables_before_initial_cache())
    options=options.concat(this.#initial_cache())

    options=options.concat(this.#install_prefix())
    options=options.concat(this.#generator())
    options=options.concat(this.#toolset())

    options=options.concat(this.#source_dir()) // Need to be the last
    console.log(options)
    return options
  }
  workingDirectory()
  {
    if(this.old_style==false) return this.binary_dir
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
    return Array('-G',this.generator)
  }

  #toolset()
  {
    this.toolset = core.getInput('toolset', { required: false })
    if(this.toolset!='') return Array('-T',this.toolset)
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
      else return Array('-DCMAKE_INSTALL_PREFIX:STRING='+this.install_prefix)
    }
    return []
  }
}

async function main()
{
try{
  let found_cmake = which.sync('cmake', { nothrow: true })
  if (found_cmake === null)
  {
    throw String('CMake program not found.')
  }
  else
  {
    global.cmake_version= await getCMakeVersion()
    const command_line_maker = new commandLineMaker()
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
    await exec.exec('cmake',command_line_maker.buildArray(), options)

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
        retentionDays: 1
    //  }
   // )
    //console.log(id)
    //${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}/artifacts/${{ steps.artifact-upload-step.outputs.artifact-id }}

}

}
catch (error)
{
  core.setFailed(error);
}
}

main()
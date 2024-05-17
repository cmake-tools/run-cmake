const core = require('@actions/core');
const exec = require('@actions/exec');
const which = require('which')
const compare_version = require('compare-versions')
const io = require('@actions/io');
const path = require('path')

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

class commandLineMaker
{
  constructor(version)
  {
    if(compare_version.compare(version, '3.13.0', '>=') ) this.old_style=false
    else this.old_style=true
    this.#fullSourceDir()
    this.#fullBinaryDir()
    this.#generator()
  }
  isOldStyle() { return this.old_style }
  buildArray() 
  {
    let options=[]
    if(this.old_style==false) options.push('-S',this.source_dir,'-B',this.binary_dir)
    else return options.push(this.source_dir)
    options.push('-G',this.generator)
    return options
  }
  buildPath() { return this.binary_dir}
  #fullSourceDir()
  {
    this.source_dir = core.getInput('source_dir', { required: false });
    if(this.source_dir=='')
    {
      this.source_dir = process.env.GITHUB_WORKSPACE;
      if(this.source_dir === undefined) this.source_dir="./"
    }
    this.source_dir=path.resolve(this.source_dir)
  }
  #fullBinaryDir()
  {
    this.binary_dir = core.getInput('binary_dir', { required: false });
    if(this.binary_dir=='')
    {
      this.binary_dir="./build"
    }
    this.binary_dir=path.resolve(this.binary_dir)
  }
  #generator()
  {
    this.generator = core.getInput('generator', { required: false });
    if(this.generator=='')
    {
      if(process.platform === "win32") this.generator="Ninja"
      else this.generator="Ninja"
    }
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
    let version= await getCMakeVersion()
    const command_line_maker = new commandLineMaker(version)
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
    if(command_line_maker.buildPath() !='')
    {
      await io.mkdirP(command_line_maker.buildPath());
      options.cwd = command_line_maker.buildPath();
    }
    await exec.exec('cmake',command_line_maker.buildArray(), options)
  }
}
catch (error)
{
  core.setFailed(error);
}
}

main()
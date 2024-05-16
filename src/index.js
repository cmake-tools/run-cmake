const core = require('@actions/core');
const exec = require('@actions/exec');
const which = require('which')

try
{
  let found_cmake = which.sync('cmake', { nothrow: true })
  if (found_cmake === null)
  {
    throw String('CMake program not found.')
  }
  else
  {
    exec.exec('cmake','--version');
  }
}
catch (error)
{
  core.setFailed(error);
}

const core = require('@actions/core');
const exec = require('@actions/exec');

try
{
  exec.exec('cmake','--version');
}
catch (error)
{
  core.setFailed(error.message);
}

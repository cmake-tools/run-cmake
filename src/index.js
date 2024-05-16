const core = require('@actions/core');
const exec = require('@actions/exec');

try
{
  exec.exec('sudo',['apt-get', 'install','--no-install-recommends', '-y','libidn11-dev')
  exec.exec('cmake','--version');
}
catch (error)
{
  core.setFailed(error.message);
}

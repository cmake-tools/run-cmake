const core = require('@actions/core');
const exec = require('@actions/exec');

try
{
  exec.exec('ln',['-s', '/usr/lib/x86_64-linux-gnu/libidn.so.12.x','/usr/lib/x86_64-linux-gnu/libidn.so.11')
  exec.exec('cmake','--version');
}
catch (error)
{
  core.setFailed(error.message);
}

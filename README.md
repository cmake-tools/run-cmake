# run-cmake
GitHub action to run CMake

## Generate a Project Buildsystem

CMake command options and corresponding action parameters :

|  CMake option                                                  |  Action parameter      |  Descritpion                                                            |  Type    |  Default                         | Available  |
|:--------------------------------------------------------------:|:----------------------:|:-----------------------------------------------------------------------:|:--------:|:--------------------------------:|:----------:|
|  -S                                                            |  source_dir            |  Path to root directory of the CMake project to build                   |  path    |  "./"                            |  ✔️         |
|  -B                                                            |  binary_dir            |  Path to directory which CMake will use as the root of build directory  |  path    |  "../build"                      |  ✔️         |
|  -C                                                            |  initial_cache         |  Pre-load a script to populate the cache                                |  file    |  ""                              |  ✔️         |
|  -D                                                            |  variables             |  Create or update a CMake **CACHE** entry                               |  array   |  []                              |  ✔️         |
|  -U                                                            |  remove_variables      |  Remove matching entries from CMake **CACHE**                           |  array   |  []                              |  ✔️         |
|  -G                                                            |  generator             |  Specify a build system generator                                       |  string  |  NMake Makefiles/Unix Makefiles  |  ✔️         |
|  -T                                                            |  toolset               |  Toolset specification for the generator, if supported                  |  string  |  ""                              |  ✔️         |
|  -A                                                            |  platform              |  Specify platform name if supported by generator                        |  string  |  ""                              |  ✔️         |
|  --toolchain                                                   |  toolchain             |  Specify the cross compiling toolchain file                             |  file    |  ""                              |  ✔️         |
|  --install-prefix                                              |  install_prefix        |  Specify the installation directory                                     |  path    |  ""                              |  ✔️         |
|  -Wno-dev/-Wdev -Wdeprecated/-Wno-deprecated (CMake3.5+)       |  configure_warnings    |  Specify the warnings to print (none, deprecated, warning, developer)   |  string  |  ""                              |  ✔️         |
|  -Werror=dev/deprecated -Wno-error=dev/deprecated (CMake3.5+)  |  configure_warnings    |  The warnings to throw error (none, deprecated, warning, developer)     |  string  |  ""                              |  ✔️         |
|  --fresh                                                       |                        |  Perform a fresh configuration of the build tree                        |          |                                  |  ❌        |
|  -L[A][H]                                                      |  list_cache_variables  |  List cached variables                                                  |  string  |  "none"                          |  ✔️         |
|  -N                                                            |                        |  View mode only                                                         |          |                                  |  ❌        |
|  --graphviz                                                    |  graphviz              |  Generate graphviz of dependencies                                      |  file    |  ""                              |  ✔️         |
|  --system-information                                          |                        |  Dump information about this system                                     |          |                                  |  ❌        |
|  --log-level                                                   |  log_level             |  Set the log level                                                      |  string  |  ""                              |  ✔️         |
|  --log-context                                                 |  log_context           |  Enable the outputting context attached to each message                 |  bool    |                                  |  ✔️         |

## Build a Build a Project

CMake command options and corresponding action parameters :

|  CMake option                     |  Action parameter               |  Description                                                                                                       |  Type    |  Default     | Available  |
|:---------------------------------:|:-------------------------------:|:------------------------------------------------------------------------------------------------------------------:|:--------:|:------------:|:----------:|
|  --parallel                       |  parallel                       |  The maximum number of concurrent processes to use when building. If omitted the number of core available is used  |          |              |  3.12+     |

## Install a Project

CMake command options and corresponding action parameters :

|  CMake option                     |  Action parameter               |  Description                                                                                                       |  Type    |  Default     | Available   |
|:---------------------------------:|:-------------------------------:|:------------------------------------------------------------------------------------------------------------------:|:--------:|:------------:|:-----------:|
|  --install                        |  binary_dir                     |  Project binary directory to install                                                                               |  string  |  "../build"  |  ✔️          |
|  --config                         |  config                         |  For multi-configuration generators, choose configuration                                                          |  string  |  ""          |  ✔️          |
|  --component                      |  component                      |  Component-based install. Only install component                                                                   |  string  |  ""          |  ✔️          |
|  --default-directory-permissions  |  default_directory_permissions  |  Default directory install permissions                                                                             |  string  |  ""          | CMake3.19+  |
|  --prefix                         |  override_install_prefix        |  Override the installation prefix                                                                                  |  string  |  ""          | CMake3.15+  |
|  --strip                          |  strip                          |  Strip before installing                                                                                           |  bool    |  false       | CMake3.15+  |
|  -v, --verbose                    |  install_verbose                |  Enable verbose output                                                                                             |  bool    |  false       |  ✔️          |

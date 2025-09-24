# run-cmake

GitHub action to run CMake

## Generate a Project Buildsystem

CMake command options and corresponding action parameters :

|  CMake option                                             |  Action parameter                          |  Description                                                            |  Type    |  Default  |    |
|:---------------------------------------------------------:|:------------------------------------------:|:-----------------------------------------------------------------------:|:--------:|:---------:|:--:|
|  -S                                                       |  source_dir                                |  Path to root directory of the CMake project to build                   |  path    |  (1)      |  ✔️ |
|  -B                                                       |  binary_dir                                |  Path to directory which CMake will use as the root of build directory  |  path    |  "./build"|  ✔️ |
|  -C                                                       |  initial_cache                             |  Pre-load a script to populate the cache                                |  file    |  ""       |  ✔️ |
|  -D                                                       |  variables                                 |  Create or update a CMake CACHE entry                                   |  array   |  []       |  ✔️ |
|  -U                                                       |  remove_variables                          |  Remove matching entries from CMake CACHE                               |  array   |  []       |  ✔️ |
|  -G                                                       |  generator                                 |  Specify a build system generator                                       |  string  |  (2)      |  ✔️ |
|  -T                                                       |  toolset                                   |  Toolset specification for the generator, if supported                  |  string  |  ""       |  ✔️ |
|  -A                                                       |  platform                                  |  Specify platform name if supported by generator                        |  string  |  ""       |  ✔️ |
|  --toolchain                                              |  toolchain                                 |  Specify the cross compiling toolchain file                             |  file    |  ""       |  ✔️ |
|  --install-prefix                                         |  install_prefix                            |  Specify the installation directory                                     |  path    |  ""       |  ✔️ |
|  -Wno-dev/-Wdev -Wdeprecated/-Wno-deprecated (3.5+)       |  configure_warnings                        |  Specify the warnings to print (none, deprecated, warning, developer)   |  string  |  ""       |  ✔️ |
|  -Werror=dev/deprecated -Wno-error=dev/deprecated (3.5+)  |  configure_warnings                        |  The warnings to throw error (none, deprecated, warning, developer)     |  string  |  ""       |  ✔️ |
|  --fresh                                                  |  fresh                                     |  Perform a fresh configuration of the build tree                        |  boolean |  false    |  ✔️ |
|  -L[AH]                                                   |  list_cache_variables                      |  List cached variables                                                  |  string  |  "none"   |  ✔️ |
|  -LR                                                      |  list_cache_variables_regex                |  Show specific cached variables                                         |  array   |  []       |  ✔️ |
|  -LRA                                                     |  list_cache_advanced_variables_regex       |  Show specific cached variables                                         |  array   |  []       |  ✔️ |
|  -LRH                                                     |  list_cache_help_variables_regex           |  Show specific cached variables                                         |  array   |  []       |  ✔️ |
|  -LRAH                                                    |  list_cache_advanced_help_variables_regex  |  Show specific cached variables                                         |  array   |  []       |  ✔️ |
|  -N                                                       |                                            |  View mode only                                                         |          |           |  ❌ |
|  --graphviz                                               |  graphviz                                  |  Generate graphviz of dependencies                                      |  file    |  ""       |  ✔️ |
|  --system-information                                     |                                            |  Dump information about this system                                     |          |           |  ❌ |
|  --print-config-dir                                       |                                            |  Print CMake config directory for user-wide FileAPI queries             |          |           |  ❌ |
|  --log-level                                              |  log_level                                 |  Set the log level                                                      |  string  |  ""       |  ✔️ |
|  --log-context                                            |  log_context                               |  Enable the outputting context attached to each message                 |  bool    |  false    |  ✔️ |
|  --sarif-output                                           |  sarif_output                              |  Write diagnostic messages to a SARIF file at the path specified        |  path    |  string   |  ✔️ |
|  --debug-trycompile                                       |  debug_trycompile                          |  Do not delete the files and directories created for try_compile()      |  bool    |  false    |  ✔️ |
|  --debug-output                                           |  debug_output                              |  Put cmake in a debug mode                                              |  bool    |  false    |  ✔️ |
|  --debug-find                                             |  debug_find                                |  Put cmake find commands in a debug mode                                |  bool    |  false    |  ✔️ |
|  --debug-find-pkg                                         |  debug_find_pkg                            |  Like --debug-find, but limiting scope to the specified packages        |  string  |  ""       |  ✔️ |
|  --debug-find-var                                         |  debug_find_var                            |  Like --debug-find, but limiting scope to the specified variable names  |  string  |  ""       |  ✔️ |
|  --trace,--trace-expand                                   |  trace                                     |  Put cmake in trace mode                                                |  string  |  (3)      |  ✔️ |
|  --trace-format                                           |  trace_format                              |  Put cmake in trace mode and sets the trace output format               |  string  |  ""       |  ✔️ |
|  --trace-source                                           |  trace_source                              |  Put cmake in trace mode, but output only lines of a specified file     |  array   |  []       |  ✔️ |
|  --trace-redirect                                         |  trace_redirect                            |  Put cmake in trace mode and redirect trace output to a file            |  string  |  ""       |  ✔️ |
|  --warn-uninitialized                                     |  warn_uninitialized                        |  Warn about uninitialized values                                        |  bool    |  false    |  ✔️ |
|  --no-warn-unused-cli                                     |  no_warn_unused_cli                        |  Don't warn about command line options                                  |  bool    |  false    |  ✔️ |
|  --check-system-vars                                      |  check_system_vars                         |  Find problems with variable usage in system files                      |  bool    |  false    |  ✔️ |
|  --compile-no-warning-as-error                            |  compile_no_warning_as_error               |  Prevent warnings from being treated as errors on compile               |  bool    |  false    |  ✔️ |
|  --link-no-warning-as-error                               |  link_no_warning_as_error                  |  Prevent warnings from being treated as errors on link                  |  bool    |  false    |  ✔️ |
|  --profiling-output                                       |  profiling_output                          |  Used in conjunction with --profiling-format to output to a given path  |  path    |  ''       |  ✔️ |
|  --profiling-format                                       |  profiling_format                          |  Enable the output of profiling data of CMake script in the given format|  string  |  ''       |  ✔️ |
|  --preset                                                 |  preset                                    |  Reads a preset from CMakePresets.json and CMakeUserPresets.json files  |  string  |  ''       |  ✔️ |
|  --list-presets                                           |                                            |  Lists the available presets                                            |          |           |  ❌ |
|  --debugger                                               |  debugger                                  |  Enables interactive debugging of the CMake language                    |  bool    |  false    |  ✔️ |
|  --debugger-pipe                                          |  debugger_pipe                             |  Name of the pipe or domain socket to use for debugger communication    |  string  |  ''       |  ✔️ |
|  --debugger-dap-log                                       |  debugger_dap_log                          |  Enables interactive debugging of the CMake language                    |  bool    |  ''       |  ✔️ |

(1) : environment variable `GITHUB_WORKSPACE` if available, otherwise "./"
(2) : default generator selected by CMake
(3) : "", "trace", "expand"

## Build a Build a Project

CMake command options and corresponding action parameters :

|  CMake option                  |  Action parameter               |  Description                                                                                      |  Type    |  Default         |  Available  |
|:------------------------------:|:-------------------------------:|:-------------------------------------------------------------------------------------------------:|:--------:|:----------------:|:-----------:|
|  --build                       |  binary_dir                     |  Project binary directory to be built                                                             |  path    |  "./build"       |  ✔️          |
|  --preset                      |  preset_build                   |  Use a build preset to specify build options                                                      |  string  |  ""              |  ✔️          |
|  --list-presets                |                                 |  Lists the available presets                                                                      |          |                  |  ❌          |
|  --parallel                    |  parallel                       |  The maximum number of concurrent processes to use when building                                  |  int     |  core available  |  3.12+      |
|  --target                      |  build_targets                  |  Build targets instead of the default target. Multiple targets may be given, separated by spaces  |  vector  |  []              |  ✔️          |
|  --config                      |  config                         |  For multi-configuration tools, choose configuration                                              |  string  |  "Debug"         |  ✔️          |
|  --clean-first                 |  clean_first                    |  Build target clean first, then build                                                             |  bool    |  false           |  ✔️          |
|  --resolve-package-references  |  resolve_package_references     |  Resolve remote package references from external package managers (e.g. NuGet) before build       |  string  |  ""              |  ✔️          |
|  -v, --verbose                 |  build_verbose                  |  Enable verbose output - if supported - including the build commands to be executed               |  bool    |  ""              |  ✔️          |
|  --                            |  to_native_tool                 |  Pass remaining options to the native tool                                                        |  vector  |  []              |  ✔️          |

## Install a Project

CMake command options and corresponding action parameters :

|  CMake option                     |  Action parameter               |  Description                                                                                |  Type    |  Default     | Available  |
|:---------------------------------:|:-------------------------------:|:-------------------------------------------------------------------------------------------:|:--------:|:------------:|:----------:|
|  --install                        |  binary_dir                     |  Project binary directory to install                                                        |  path    |  "./build"   |  ✔️         |
|  --config                         |  install_config                 |  For multi-configuration generators, choose configuration                                   |  string  |  "Debug"     |  ✔️         |
|  --component                      |  component                      |  Component-based install. Only install component                                            |  string  |  ""          |  ✔️         |
|  --default-directory-permissions  |  default_directory_permissions  |  Default directory install permissions                                                      |  string  |  ""          | 3.19+      |
|  --prefix                         |  prefix                         |  Override the installation prefix                                                           |  string  |  ""          | 3.15+      |
|  --strip                          |  strip                          |  Strip before installing                                                                    |  bool    |  false       | 3.15+      |
|  -v, --verbose                    |  install_verbose                |  Enable verbose output                                                                      |  bool    |  false       |  ✔️         |
|  --parallel                       |  install_parallel               |  Install in parallel using the given number of jobs                                         |  int     |              |  ✔️         |

ncc build ./src/index.js -o dist
node dist/index.js
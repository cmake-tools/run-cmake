# run-cmake
GitHub action to run CMake

## Generate a Project Buildsystem

CMake command options and corresponding action parameters :

|  CMake option      |  Action parameter  |  Descritpion                                                            |  Type  |  Default |
|:------------------:|:------------------:|:-----------------------------------------------------------------------:|:------:|:--------:|
|  -S                |  source_dir        |  Path to root directory of the CMake project to build                   |        |          |
|  -B                |  binary_dir        |  Path to directory which CMake will use as the root of build directory  |        |          |
|  -C                |  initial_cache     |  Pre-load a script to populate the cache                                |        |          |
|  -D                |  variables         |  Create or update a CMake **CACHE** entry                               |        |          |
|  -U                |  remove_variables  |  Remove matching entries from CMake **CACHE**                           |        |          |
|  -G                |  generator         |  Specify a build system generator                                       |        |          |
|  -T                |  toolset           |  Toolset specification for the generator, if supported                  |        |          |
|  -A                |  platform          |  Specify platform name if supported by generator                        |        |          |
|  --toolchain       |  toolchain         |  Specify the cross compiling toolchain file                             |        |          |
|  --install-prefix  |  install_prefix    |  Specify the installation directory                                     |        |          |
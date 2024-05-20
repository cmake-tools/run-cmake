if(NOT ALREADY_LOAD)
  cmake_minimum_required(VERSION ${CMAKE_VERSION})
  project(test)
endif()

message(STATUS "Options:")
message(STATUS "\t- source_dir : ${CMAKE_SOURCE_DIR}")
message(STATUS "\t- binary_dir : ${CMAKE_BINARY_DIR}")
message(STATUS "\t- generator : ${CMAKE_GENERATOR}")
message(STATUS "\t- install_prefix : ${CMAKE_INSTALL_PREFIX}")

message(STATUS "\t- MY_VARIABLE : ${MY_VARIABLE}")
message(STATUS "\t- MY_VARIABLE2 : ${MY_VARIABLE2}")
add_executable(Main src/main.cpp)
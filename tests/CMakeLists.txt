if(NOT ALREADY_LOAD)
  cmake_minimum_required(VERSION ${CMAKE_VERSION})
  project(test)
endif()

message(STATUS "Options:")
message(STATUS "\t- source_dir : ${CMAKE_SOURCE_DIR}")
message(STATUS "\t- binary_dir : ${CMAKE_BINARY_DIR}")
message(STATUS "\t- generator : ${CMAKE_GENERATOR}")
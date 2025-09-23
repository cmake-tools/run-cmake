cmake_minimum_required(VERSION 3.0...${CMAKE_VERSION} FATAL_ERROR)

project(run-cmake LANGUAGES CXX)

message(STATUS "${TOTO} ${TITI} ${TATA}")

file(WRITE "${PROJECT_BINARY_DIR}/main.cpp" [[int main(){}]])

include(GNUInstallDirs)
add_executable(Main "${PROJECT_BINARY_DIR}/main.cpp")
add_test(NAME Main COMMAND Main)
install(TARGETS Main RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}")

add_executable(Main2 "${PROJECT_BINARY_DIR}/main.cpp")
add_test(NAME Main2 COMMAND Main2)
install(TARGETS Main2 RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}")

add_executable(Main3 "${PROJECT_BINARY_DIR}/main.cpp")
add_test(NAME Main3 COMMAND Main3)
install(TARGETS Main3 RUNTIME DESTINATION "${CMAKE_INSTALL_BINDIR}")

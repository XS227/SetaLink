cmake_minimum_required(VERSION 3.22.1)
project("setalink_vpn")

add_library(setalink_vpn SHARED tunnel_helper.cpp)
target_link_libraries(setalink_vpn android log)

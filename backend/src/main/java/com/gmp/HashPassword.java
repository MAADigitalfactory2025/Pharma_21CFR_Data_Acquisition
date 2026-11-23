package com.gmp;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
public class HashPassword {public static void main(String[] args){if(args.length!=1)throw new IllegalArgumentException("Provide one password");System.out.println(new BCryptPasswordEncoder(12).encode(args[0]));}}

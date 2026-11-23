package com.gmp;
/** Dedicated backend-only credential configuration. Set hashes via environment; never commit real secrets. */
public final class Credentials {
 private Credentials(){}
 public static final String SYSTEM_PASSWORD_HASH=System.getenv("GMP_SYSTEM_PASSWORD_HASH");
 public static final String ITADMIN_PASSWORD_HASH=System.getenv("GMP_ITADMIN_PASSWORD_HASH");
}

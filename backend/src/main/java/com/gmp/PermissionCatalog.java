package com.gmp;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.util.*;
/** Read-only hierarchy. Only implemented=true permissions can be granted by the existing API. */
public final class PermissionCatalog {
 private PermissionCatalog() {}
 private static final List<?> MODULES = load();
 private static List<?> load() {
  try(InputStream in=PermissionCatalog.class.getResourceAsStream("/permission-catalog.json")) {
   if(in==null) throw new IllegalStateException("Permission catalog resource missing");
   return new ObjectMapper().readValue(in,List.class);
  } catch(Exception e) {throw new ExceptionInInitializerError(e);}
 }
 public static List<?> modules(){return MODULES;}
}

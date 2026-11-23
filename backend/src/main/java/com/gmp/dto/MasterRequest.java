package com.gmp.dto;
import java.util.*;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
/** Shared fields for master create and partial update requests. */
@JsonIgnoreProperties(ignoreUnknown = true)
public class MasterRequest {
 public String name, comments, adminPassword;
 public Boolean active;
 public Map<String,Object> fields(){Map<String,Object> m=new LinkedHashMap<>();if(name!=null)m.put("name",name);if(comments!=null)m.put("comments",comments);if(active!=null)m.put("active",active);if(adminPassword!=null)m.put("adminPassword",adminPassword);return m;}
}

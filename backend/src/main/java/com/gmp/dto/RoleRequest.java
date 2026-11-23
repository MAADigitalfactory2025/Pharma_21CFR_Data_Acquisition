package com.gmp.dto;
import java.util.*;
public class RoleRequest extends MasterRequest {
 public List<String> permissions;
 @Override public Map<String,Object> fields(){Map<String,Object> m=super.fields();if(permissions!=null)m.put("permissions",permissions);return m;}
}

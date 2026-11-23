package com.gmp.dto;
import java.util.*;
public class UserRequest extends MasterRequest {
 public String username,fullName,designation,department,password,roleId;
 public List<String> machineIds;
 @Override public Map<String,Object> fields(){Map<String,Object> m=super.fields();if(username!=null)m.put("username",username);if(fullName!=null)m.put("fullName",fullName);if(designation!=null)m.put("designation",designation);if(password!=null)m.put("password",password);if(department!=null)m.put("department",department);if(roleId!=null)m.put("roleId",roleId);if(machineIds!=null)m.put("machineIds",machineIds);return m;}
}

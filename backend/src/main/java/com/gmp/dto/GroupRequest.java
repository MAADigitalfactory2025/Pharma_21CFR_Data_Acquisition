package com.gmp.dto;
import java.util.*;
public class GroupRequest extends MasterRequest {
 public String roleId;
 public List<String> machineIds,additionalPermissions,deniedPermissions;
 @Override public Map<String,Object> fields(){Map<String,Object> m=super.fields();if(roleId!=null)m.put("roleId",roleId);if(machineIds!=null)m.put("machineIds",machineIds);if(additionalPermissions!=null)m.put("additionalPermissions",additionalPermissions);if(deniedPermissions!=null)m.put("deniedPermissions",deniedPermissions);return m;}
}

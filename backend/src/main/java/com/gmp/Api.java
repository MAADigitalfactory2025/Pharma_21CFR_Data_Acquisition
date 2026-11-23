package com.gmp;
import java.time.Instant;
import java.util.*;
import com.gmp.dto.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.*;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import jakarta.servlet.http.HttpSession;
import org.bson.Document;
import org.springframework.web.server.ResponseStatusException;

@RestController @RequestMapping("/api") public class Api {
 private final ObjectMapper mapper=new ObjectMapper(); private final MongoTemplate db; private final BCryptPasswordEncoder bcrypt=new BCryptPasswordEncoder(12);
 private static final long IDLE_MS=7*60*1000L;
 private final Map<String,SessionInfo> sessions=new java.util.concurrent.ConcurrentHashMap<>();
 private static class SessionInfo {final HttpSession session;final String userId;final String name;final long loginTime;volatile long lastActivity;SessionInfo(HttpSession s,String uid,String n){session=s;userId=uid;name=n;loginTime=System.currentTimeMillis();lastActivity=loginTime;}}
 private void registerSession(HttpSession s,String uid,String name){s.setMaxInactiveInterval(7*60);s.setAttribute("lastActivity",System.currentTimeMillis());sessions.put(s.getId(),new SessionInfo(s,uid,name));}
 private void endSession(HttpSession s,String event){SessionInfo info=sessions.remove(s.getId());if(info!=null)log(info.userId,info.name,event,"SYSTEM","");try{s.invalidate();}catch(IllegalStateException ignored){}}
 private void checkActivity(HttpSession s,boolean touch){if(who(s)==null)return;Object value=s.getAttribute("lastActivity");long last=value instanceof Number?((Number)value).longValue():System.currentTimeMillis();if(System.currentTimeMillis()-last>=IDLE_MS){endSession(s,"SESSION_TIMEOUT");throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Session expired after seven minutes of inactivity");}if(touch){long time=System.currentTimeMillis();s.setAttribute("lastActivity",time);SessionInfo info=sessions.get(s.getId());if(info!=null)info.lastActivity=time;}}
 private static final String[] INITIAL={"FBD 5 KG","FBD 10 KG","FBD 450 KG","RMG 150","Coating Panel 18\"","Coating Panel 36\"","Conta Blender 150 L","Conta Blender 350","APCG-300C / FBB 300"};
 public Api(MongoTemplate db){
  this.db=db;
  migratePrefixedIds();
  seedPermissionsAndMigrate();
  for(int i=0;i<INITIAL.length;i++){
   String id=String.format("M%03d",i+1);
   Document existing=db.findById(id,Document.class,"machines");
   if(existing==null){
    db.insert(new Document("_id",id).append("name",INITIAL[i]).append("active",true).append("createdAt",Instant.now().toString()).append("createdBy", "SYSTEM"),"machines");
   }else if(("M004".equals(id)&&"RMG 150 (unit unconfirmed)".equals(existing.getString("name")))
      ||("M008".equals(id)&&"Conta Blender 350 L (assumed)".equals(existing.getString("name")))){
    db.updateFirst(Query.query(Criteria.where("_id").is(id)),new Update().set("name",INITIAL[i]),"machines");
   }
  }
 }
 // Stable, unique human-readable identifiers. The counter is atomic across requests.
 private String nextId(String collection){
  String prefix=switch(collection){case "users"->"UR";case "roles"->"R";case "role_permissions"->"RP";case "permissions"->"P";default->throw new IllegalArgumentException(collection);};
  Document counter=db.findAndModify(Query.query(Criteria.where("_id").is(prefix)),
    new Update().inc("seq",1),FindAndModifyOptions.options().upsert(true).returnNew(true),
    Document.class,"id_counters");
  return prefix+String.format("%03d",((Number)counter.get("seq")).longValue());
 }
 private void migrateCollectionIds(String collection){
  String prefix=switch(collection){case "users"->"UR";case "roles"->"R";case "role_permissions"->"RP";case "permissions"->"P";default->throw new IllegalArgumentException(collection);};
  List<Document> all=db.findAll(Document.class,collection);
  long max=0;
  for(Document d:all){Object id=d.get("_id");if(id instanceof String v&&v.matches(prefix+"\\d+"))max=Math.max(max,Long.parseLong(v.substring(prefix.length())));}
  // Never reuse an ID, including after deletion or a partially completed migration.
  Document counter=db.findById(prefix,Document.class,"id_counters");
  long current=counter==null?0:((Number)counter.getOrDefault("seq",0)).longValue();
  if(max>current)db.upsert(Query.query(Criteria.where("_id").is(prefix)),
    new Update().set("seq",max),"id_counters");
  for(Document old:all){
   Object oldId=old.get("_id");
   if(oldId instanceof String v&&v.matches(prefix+"\\d+"))continue;
   String legacyKey=collection+":"+String.valueOf(oldId);
   Document mapping=db.findById(legacyKey,Document.class,"id_migrations");
   String newId;
   if(mapping==null){
    newId=nextId(collection);
    db.insert(new Document("_id",legacyKey).append("newId",newId),"id_migrations");
   }else newId=mapping.getString("newId");
   if(db.findById(newId,Document.class,collection)==null){
    Document replacement=new Document(old);replacement.put("_id",newId);
    db.insert(replacement,collection);
   }
   // Rewrite live foreign-key references; never modify historical audit entries.
   if("roles".equals(collection)){
    for(String target:List.of("users","groups","role_permissions"))
     db.updateMulti(Query.query(Criteria.where("roleId").is(oldId)),
       new Update().set("roleId",newId),target);
   }else if("users".equals(collection)){
    for(String target:List.of("roles","users","groups"))
     for(String field:List.of("createdBy","updatedBy"))
      db.updateMulti(Query.query(Criteria.where(field).is(oldId)),
        new Update().set(field,newId),target);
   }else if("permissions".equals(collection)){
    db.updateMulti(Query.query(Criteria.where("permissionId").is(oldId)),
      new Update().set("permissionId",newId),"role_permissions");
   }
   db.remove(Query.query(Criteria.where("_id").is(oldId)),collection);
  }
 }
 private void migratePrefixedIds(){
  // Migrate parent records before dependent join records.
  migrateCollectionIds("roles");
  migrateCollectionIds("users");
  migrateCollectionIds("permissions");
  migrateCollectionIds("role_permissions");
 }
 private String permissionId(String action){
  Document permission=db.findOne(Query.query(Criteria.where("action").is(action)),Document.class,"permissions");
  return permission==null?null:permission.getString("_id");
 }
 private void seedPermissionsAndMigrate(){
  List<String> actions=new ArrayList<>(ROLE_PERMISSIONS);
  Collections.sort(actions);
  for(String action:actions){
   Document current=db.findOne(Query.query(Criteria.where("action").is(action)),Document.class,"permissions");
   if(current==null){
    db.insert(new Document("_id",nextId("permissions")).append("action",action)
      .append("description",action.equals("ACCESS_ADMIN_LOGBOOK")?
        "Read the centralized Administrative Logbook":
        action.equals("GENERATE_EXCEL_REPORT")?"Generate Excel reports":
        action.substring(action.lastIndexOf('.')+1).replace('_',' ')),"permissions");
   }
   String id=permissionId(action);
   db.updateMulti(Query.query(Criteria.where("permissionId").is(action)),
     new Update().set("permissionId",id),"role_permissions");
  }
  // Existing users are migrated in place; historical groups and audit records are not deleted.
  for(Document user:db.findAll(Document.class,"users")){
   boolean changed=false;
   if(user.getString("roleId")==null&&user.getString("groupId")!=null){Document group=byId("groups",user.getString("groupId"));if(group!=null){user.put("roleId",group.getString("roleId"));changed=true;
    Set<String> ids=new LinkedHashSet<>();if(group.get("machineIds") instanceof List<?> old)for(Object v:old)if(v instanceof String id)ids.add(id);
    if(user.get("machineIds") instanceof List<?> old)for(Object v:old)if(v instanceof String id)ids.add(id);
    user.put("machineIds",new ArrayList<>(ids));changed=true;
   }}
   if(changed)db.save(user,"users");
  }
  for(Document role:db.findAll(Document.class,"roles")){
   refreshRolePermissionNames(role.getString("_id"),role.getString("name"));
   if(db.count(Query.query(Criteria.where("roleId").is(role.getString("_id"))),"role_permissions")==0)
    syncRolePermissions(role.getString("_id"),allowedPermissions(role.get("permissions")));
  }
 }
 private void refreshRolePermissionNames(String roleId,String roleName){
  // Idempotent migration and rename propagation. Keep IDs and permission codes intact.
  db.updateMulti(Query.query(Criteria.where("roleId").is(roleId)),
    new Update().set("roleName",roleName==null?"":roleName),"role_permissions");
 }
 private void syncRolePermissions(String roleId,Set<String> codes){
  Document role=byId("roles",roleId);
  String roleName=role==null?"":String.valueOf(role.getOrDefault("name",""));
  db.remove(Query.query(Criteria.where("roleId").is(roleId)),"role_permissions");
  for(String code:codes)db.insert(new Document("_id",nextId("role_permissions")).append("roleId",roleId).append("roleName",roleName).append("permissionId",permissionId(code)),"role_permissions");
 }
 private Map<String,Object> result(Object data){return Map.of("data",data);} private String now(){return Instant.now().toString();}
 private String who(HttpSession s){return (String)s.getAttribute("uid");} private String username(HttpSession s){return (String)s.getAttribute("username");}
 private void require(HttpSession s,boolean admin){
  if(who(s)==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Login required");checkActivity(s,false);
  if(!"ITADMIN".equals(who(s))){Document user=byId("users",who(s));
   if(user==null||!Boolean.TRUE.equals(user.get("active"))||Boolean.TRUE.equals(user.get("locked"))){s.invalidate();throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Account disabled or locked");}}
  if(admin && !"ITADMIN".equals(who(s)))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"ITADMIN required");
 }
 private Set<String> groupMachines(Document user){return Set.of();}
 private Set<String> effectiveMachines(Document user){
  Set<String> ids=new HashSet<>();if(user!=null&&user.get("machineIds") instanceof List<?> list)
   for(Object value:list)if(value instanceof String id)ids.add(id);return ids;
 }
 private void verifyAdminPassword(Map<String,?> body,HttpSession session,String action){
  require(session,true);
  String supplied=body.get("adminPassword") instanceof String p?p:"";
  String hash=Credentials.ITADMIN_PASSWORD_HASH;
  if(hash==null||hash.isBlank())throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"ITADMIN password not configured");
  boolean valid=false;
  try{valid=bcrypt.matches(supplied,hash);}catch(IllegalArgumentException ignored){}
  if(!valid){
   log("ITADMIN","ITADMIN","ADMIN_VERIFICATION_FAILED","ITADMIN",action);
   throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"ITADMIN password verification failed");
  }
 }
 private Set<String> rolePermissions(Document u){
  if(u==null)return Set.of();String roleId=u.getString("roleId");if(roleId==null)return Set.of();
  Document role=byId("roles",roleId);if(role==null||Boolean.FALSE.equals(role.get("active")))return Set.of();
  Set<String> codes=new HashSet<>();for(Document rp:db.find(Query.query(Criteria.where("roleId").is(roleId)),Document.class,"role_permissions")){
   Object permissionId=rp.get("permissionId");
   Document permission=permissionId==null?null:db.findById(permissionId,Document.class,"permissions");
   String code=permission==null?null:permission.getString("action");
   if(code!=null&&ROLE_PERMISSIONS.contains(code))codes.add(code);
  }return codes;
 }
 private String normalizePermission(String p){return p.startsWith("FBD_OPERATIONS.")?"MACHINE_MONITORING."+p.substring("FBD_OPERATIONS.".length()):p;}
 private Set<String> allowedPermissions(Object value){
  Set<String> out=new HashSet<>();
  if(value instanceof List<?> list)for(Object v:list)if(v instanceof String p){String normalized=normalizePermission(p);if(ROLE_PERMISSIONS.contains(normalized))out.add(normalized);}
  return out;
 }
 private Set<String> effectivePermissions(Document u){
  Set<String> out=new HashSet<>(rolePermissions(u));
  
  return out;
 }
 private Set<String> permissions(HttpSession s){
  if("ITADMIN".equals(who(s)))return ROLE_PERMISSIONS;
  return effectivePermissions(byId("users",who(s)));
 }
 private void requirePermission(HttpSession s,String permission){require(s,false);if(!"ITADMIN".equals(who(s))&&!permissions(s).contains(permission))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Missing permission: "+permission);}
 private String collectionPermission(String coll){return switch(coll){case "audit_logs"->"ACCESS_ADMIN_LOGBOOK";case "machines"->"VIEW_MACHINES";default->null;};}
 private void requireCollection(HttpSession s,String coll){if(Set.of("users","roles").contains(coll)){require(s,true);return;}String p=collectionPermission(coll);if(p==null){require(s,true);return;}requirePermission(s,p);}
 private void validateMachineIds(Object value){if(!(value instanceof List<?> ids))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"machineIds must be an array");for(Object id:ids){if(!(id instanceof String v)||byId("machines",v)==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Unknown machine ID: "+id);}}
 private void validateGroupRole(String roleId){Document role=roleId==null?null:byId("roles",roleId);if(role==null||Boolean.FALSE.equals(role.get("active")))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"An active role must be selected");}
 private void validateUserRole(String roleId){validateGroupRole(roleId);}
 private void log(String userId,String userName,String event,String actor,String comment){db.insert(new Document("_id",UUID.randomUUID().toString()).append("userId",userId).append("username",userName).append("event",event).append("performedBy",actor).append("comments",comment==null?"":comment).append("timestamp",now()),"audit_logs");}
 private Document byId(String collection,String id){return db.findById(id,Document.class,collection);} private String str(Document d,String k){return d.getString(k);}
 private Document input(Map<String,Object> data){Document d=new Document();data.forEach((k,v)->{if(!Set.of("_id","passwordHash","password","adminPassword","email","createdBy","createdAt","updatedBy","updatedAt","failedAttempts","locked","inheritedPermissions","effectivePermissions","inheritedMachineIds","effectiveMachineIds").contains(k))d.put(k,v);});return d;}
 private static final Set<String> ROLE_PERMISSIONS=Set.of("MACHINE_MONITORING.MACHINE_PARAMETERS.MODIFY_LIMITS","MACHINE_MONITORING.MACHINE_PARAMETERS.PROPOSE_LIMIT_CHANGE","MACHINE_MONITORING.MACHINE_PARAMETERS.APPROVE_LIMIT_CHANGE","MACHINE_MONITORING.BATCH_MANAGEMENT.CREATE_BATCH","MACHINE_MONITORING.BATCH_MANAGEMENT.CLOSE_BATCH","MACHINE_MONITORING.ALARM_MANAGEMENT.ACKNOWLEDGE_ALARM","ACCESS_ADMIN_LOGBOOK","GENERATE_EXCEL_REPORT");
 private void normalizePermissionFields(Map<String,Object> body){for(String key:List.of("permissions","additionalPermissions","deniedPermissions")){Object raw=body.get(key);if(raw instanceof List<?> values){List<Object> normalized=new ArrayList<>();for(Object v:values)normalized.add(v instanceof String p?normalizePermission(p):v);body.put(key,normalized);}}}
 private void validatePermissionList(Object value,String field){
  if(!(value instanceof List<?> list)||list.stream().anyMatch(v->!(v instanceof String)||!ROLE_PERMISSIONS.contains(v))||new HashSet<>(list).size()!=list.size())
   throw new ResponseStatusException(HttpStatus.BAD_REQUEST,field+" must contain unique supported permission codes");
 }
 private void validateRolePermissions(Map<String,Object> body){normalizePermissionFields(body);if(body.containsKey("permissions"))validatePermissionList(body.get("permissions"),"permissions");}
 private void validateUserPermissions(Map<String,Object> body){normalizePermissionFields(body);if(body.containsKey("additionalPermissions"))validatePermissionList(body.get("additionalPermissions"),"additionalPermissions");if(body.containsKey("deniedPermissions"))validatePermissionList(body.get("deniedPermissions"),"deniedPermissions");}
 private Document audit(Document d,HttpSession s,boolean create){if(create){d.put("createdAt",now());d.put("createdBy",who(s));}d.put("updatedAt",now());d.put("updatedBy",who(s));return d;}
 private Map<String,Object> masterRequest(String coll,JsonNode node){
  if(node==null||!node.isObject())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"JSON object required");
  Class<? extends MasterRequest> type=switch(coll){case "roles"->RoleRequest.class;case "users"->UserRequest.class;default->throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Unsupported master entity");};
  try{return mapper.treeToValue(node,type).fields();}catch(Exception e){throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid master request",e);}
 }
 private IdNameResponse reference(String coll,String id,String label){
  if(id==null||id.isBlank())return null;
  if("ITADMIN".equals(id))return new IdNameResponse(id,"ITADMIN");
  Document related=byId(coll,id);
  String name=related==null?id:String.valueOf(related.getOrDefault(label,id));
  return new IdNameResponse(id,name);
 }
 private Object masterResponse(String coll,Document doc){
  Document x=(Document)("users".equals(coll)?safeUser(doc):safe(doc));
  if("users".equals(coll))x.put("role",reference("roles",doc.getString("roleId"),"name"));
  // Keep the original IDs for existing frontend forms and provide structured references in parallel.
  return switch(coll){case "roles"->new RoleResponse(x);case "users"->new UserResponse(x);default->new MasterResponse(x);};
 }
 private Object safe(Document d){if(d==null)return null;Document x=new Document(d);x.remove("passwordHash");x.remove("_class");for(String k:List.of("createdBy","updatedBy")){String id=x.getString(k);if(id!=null){Document u=byId("users",id);x.put(k,Map.of("id",id,"name",u==null?id:u.getString("username")));}}return x;}
 private Object safeUser(Document d){Document x=(Document)safe(d);x.remove("email");x.put("inheritedPermissions",new ArrayList<>(new TreeSet<>(rolePermissions(d))));x.put("effectivePermissions",new ArrayList<>(new TreeSet<>(effectivePermissions(d))));x.putIfAbsent("additionalPermissions",List.of());x.put("inheritedMachineIds",new ArrayList<>(new TreeSet<>(groupMachines(d))));x.put("effectiveMachineIds",new ArrayList<>(new TreeSet<>(effectiveMachines(d))));return x;}
 private List<Object> safeList(String coll){return db.findAll(Document.class,coll).stream().map(d->Set.of("users","roles").contains(coll)?masterResponse(coll,d):safe(d)).toList();}
 @PostMapping("/gate") public Object gate(@RequestBody Map<String,String> b,HttpSession s){if(Credentials.SYSTEM_PASSWORD_HASH==null)throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"System password not configured");if(!bcrypt.matches(b.getOrDefault("password",""),Credentials.SYSTEM_PASSWORD_HASH))throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Invalid password");s.setAttribute("gate",true);return result("ok");}
 @PostMapping("/login") public Object login(@RequestBody Map<String,String> b,HttpSession s){if(!Boolean.TRUE.equals(s.getAttribute("gate")))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"System entry required");String name=b.getOrDefault("username","").trim();String pass=b.getOrDefault("password","");if("ITADMIN".equals(name)){if(Credentials.ITADMIN_PASSWORD_HASH==null)throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"ITADMIN password not configured");if(!bcrypt.matches(pass,Credentials.ITADMIN_PASSWORD_HASH)){log("ITADMIN","ITADMIN","FAILED_LOGIN","ITADMIN","");throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Invalid credentials");}s.setAttribute("uid","ITADMIN");s.setAttribute("username","ITADMIN");registerSession(s,"ITADMIN","ITADMIN");log("ITADMIN","ITADMIN","LOGIN","ITADMIN","");return result(Map.of("username","ITADMIN","admin",true,"permissions",ROLE_PERMISSIONS));}
 Document u=db.findOne(Query.query(Criteria.where("username").is(name)),Document.class,"users");if(u==null){log("UNKNOWN",name,"FAILED_LOGIN","SYSTEM","");throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Invalid credentials");}String id=u.getString("_id");if(Boolean.TRUE.equals(u.get("locked"))){log(id,name,"BLOCKED_LOGIN","SYSTEM","");throw new ResponseStatusException(HttpStatus.LOCKED,"Account locked; contact ITADMIN");}if(!Boolean.TRUE.equals(u.get("active"))){throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Account inactive");}
 if(!bcrypt.matches(pass,u.getString("passwordHash"))){int n=((Number)u.getOrDefault("failedAttempts",0)).intValue()+1;u.put("failedAttempts",n);log(id,name,"FAILED_LOGIN","SYSTEM",n+"/3");if(n>=3){u.put("locked",true);log(id,name,"ACCOUNT_LOCKED","SYSTEM","");}db.save(u,"users");throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,n>=3?"Account locked":"Invalid credentials");}
 u.put("failedAttempts",0);db.save(u,"users");s.setAttribute("uid",id);s.setAttribute("username",name);registerSession(s,id,name);log(id,name,"LOGIN",id,"");return result(Map.of("username",name,"admin",false,"permissions",permissions(s)));}
 @PostMapping("/logout") public Object logout(HttpSession s){if(who(s)!=null)log(who(s),username(s),"LOGOUT",who(s),"");sessions.remove(s.getId());s.invalidate();return result("ok");}
 // Browser-history navigation locks the authenticated identity without allowing a stale session to access APIs.
 @PostMapping("/navigation-lock") public Object navigationLock(HttpSession s){
  String id=who(s);if(id==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Not signed in");
  String name=username(s);
  sessions.remove(s.getId());
  s.removeAttribute("uid");s.removeAttribute("username");s.removeAttribute("lastActivity");
  s.setAttribute("reauthUid",id);s.setAttribute("reauthUsername",name);
  s.setAttribute("reauthUntil",System.currentTimeMillis()+5*60*1000L);
  log(id,name,"LOGOUT",id,"Browser back navigation");
  return result(Map.of("username",name,"locked",true));
 }
 @GetMapping("/reauth-state") public Object reauthState(HttpSession s){
  Object id=s.getAttribute("reauthUid");Object until=s.getAttribute("reauthUntil");
  boolean pending=id instanceof String && until instanceof Number && System.currentTimeMillis()<((Number)until).longValue();
  return result(pending?Map.of("pending",true,"username",String.valueOf(s.getAttribute("reauthUsername"))):Map.of("pending",false));
 }
 @PostMapping("/reauth") public Object reauth(@RequestBody Map<String,String> b,HttpSession s){
  Object id=s.getAttribute("reauthUid");Object until=s.getAttribute("reauthUntil");
  if(!(id instanceof String)||!(until instanceof Number)||System.currentTimeMillis()>=((Number)until).longValue())
   throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Reauthentication expired; sign in normally");
  String uid=(String)id;String name=(String)s.getAttribute("reauthUsername");String password=b.getOrDefault("password","");
  if("ITADMIN".equals(uid)){
   if(Credentials.ITADMIN_PASSWORD_HASH==null||!bcrypt.matches(password,Credentials.ITADMIN_PASSWORD_HASH))
    throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Invalid password");
  }else{
   Document u=byId("users",uid);
   if(u==null||!Boolean.TRUE.equals(u.get("active")))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Account inactive");
   if(Boolean.TRUE.equals(u.get("locked")))throw new ResponseStatusException(HttpStatus.LOCKED,"Account locked");
   if(!bcrypt.matches(password,u.getString("passwordHash"))){
    int n=((Number)u.getOrDefault("failedAttempts",0)).intValue()+1;u.put("failedAttempts",n);
    if(n>=3){u.put("locked",true);log(uid,name,"ACCOUNT_LOCKED","SYSTEM","");}
    db.save(u,"users");log(uid,name,"FAILED_LOGIN","SYSTEM","Reauthentication");
    throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,n>=3?"Account locked":"Invalid password");
   }
   u.put("failedAttempts",0);db.save(u,"users");
  }
  s.removeAttribute("reauthUid");s.removeAttribute("reauthUsername");s.removeAttribute("reauthUntil");
  s.setAttribute("uid",uid);s.setAttribute("username",name);registerSession(s,uid,name);
  log(uid,name,"LOGIN",uid,"Password-only reauthentication");
  return result(Map.of("username",name,"admin","ITADMIN".equals(uid),"permissions",permissions(s)));
 }
 @PostMapping("/activity") public Object userActivity(HttpSession s){require(s,false);checkActivity(s,true);return result("ok");}
 @GetMapping("/permission-catalog") public Object permissionCatalog(HttpSession s){require(s,false);return result(PermissionCatalog.modules());}
 @GetMapping("/me") public Object me(HttpSession s){require(s,false);return result(Map.of("id",who(s),"username",username(s),"admin","ITADMIN".equals(who(s)),"permissions",permissions(s)));}
 @GetMapping("/machines") public Object machines(HttpSession s){require(s,false);Document u=byId("users",who(s));Set<String> allowed=effectiveMachines(u);return result(db.findAll(Document.class,"machines").stream().map(m->{Document x=new Document(m);x.put("accessible",("ITADMIN".equals(who(s))||allowed.contains(m.getString("_id")))&&Boolean.TRUE.equals(m.get("active")));return x;}).toList());}
 @GetMapping("/machines/{id}/authorize") public Object authorize(@PathVariable String id,HttpSession s){require(s,false);Document m=byId("machines",id);if(m==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND);if(!Boolean.TRUE.equals(m.get("active")))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Machine inactive");Document u=byId("users",who(s));if(!"ITADMIN".equals(who(s))&&(u==null||!effectiveMachines(u).contains(id)))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Machine access denied");return result(Map.of("machineId",id,"allowed",true));}
 @GetMapping("/machines/{id}/data-access") public Object machineDataAccess(@PathVariable String id,HttpSession s){authorize(id,s);return result(Map.of("machineId",id,"allowed",true,"scope","machine-data"));}
 
 @GetMapping("/admin/{coll}") public Object list(@PathVariable String coll,HttpSession s){requireCollection(s,coll);if(!Set.of("users","roles","machines","audit_logs").contains(coll))throw new ResponseStatusException(HttpStatus.NOT_FOUND);return result(safeList(coll));}
 @PostMapping("/admin/{coll}") public Object create(@PathVariable String coll,@RequestBody JsonNode request,HttpSession s){Map<String,Object> b=masterRequest(coll,request);requireCollection(s,coll);verifyAdminPassword(b,s,"MASTER_CREATE");if(!Set.of("users","roles").contains(coll))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);if("roles".equals(coll)){validateRolePermissions(b);}if("users".equals(coll)){validateUserRole((String)b.get("roleId"));if(b.containsKey("machineIds"))validateMachineIds(b.get("machineIds"));}Document d=audit(input(b),s,true);d.put("_id",nextId(coll));if("users".equals(coll)){String password=(String)b.get("password");if(password==null||password.length()<8)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Password must be at least 8 characters");if(db.exists(Query.query(Criteria.where("username").is(b.get("username"))),"users"))throw new ResponseStatusException(HttpStatus.CONFLICT,"Username exists");d.put("passwordHash",bcrypt.encode(password));d.put("failedAttempts",0);d.put("locked",false);d.putIfAbsent("active",true);d.putIfAbsent("machineIds",List.of());d.putIfAbsent("additionalPermissions",List.of());}db.insert(d,coll);if("roles".equals(coll))syncRolePermissions(d.getString("_id"),allowedPermissions(d.get("permissions")));log(d.getString("_id"),String.valueOf(b.getOrDefault("name",b.getOrDefault("username",coll))),coll.toUpperCase()+"_CREATED","ITADMIN",String.valueOf(b.getOrDefault("comments","")));return result(masterResponse(coll,d));}
 @PutMapping("/admin/{coll}/{id}") public Object update(@PathVariable String coll,@PathVariable String id,@RequestBody JsonNode request,HttpSession s){Map<String,Object> b=masterRequest(coll,request);requireCollection(s,coll);verifyAdminPassword(b,s,"MASTER_UPDATE");if(!Set.of("users","roles").contains(coll))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);Document d=byId(coll,id);if(d==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND);if("roles".equals(coll)){validateRolePermissions(b);}if("users".equals(coll)){validateUserRole((String)b.getOrDefault("roleId",d.getString("roleId")));if(b.containsKey("machineIds"))validateMachineIds(b.get("machineIds"));}d.putAll(input(b));if("users".equals(coll)&&b.containsKey("password")&&!String.valueOf(b.get("password")).isBlank()){String p=String.valueOf(b.get("password"));if(p.length()<8)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Password too short");d.put("passwordHash",bcrypt.encode(p));d.remove("password");}audit(d,s,false);db.save(d,coll);if("roles".equals(coll)){if(b.containsKey("permissions"))syncRolePermissions(id,allowedPermissions(d.get("permissions")));else refreshRolePermissionNames(id,d.getString("name"));}log(id,String.valueOf(d.getOrDefault("username",d.getOrDefault("name",id))),coll.toUpperCase()+"_UPDATED","ITADMIN",String.valueOf(b.getOrDefault("comments","")));return result(masterResponse(coll,d));}
 @DeleteMapping("/admin/{coll}/{id}") public Object delete(@PathVariable String coll,@PathVariable String id,@RequestBody Map<String,Object> b,HttpSession s){requireCollection(s,coll);verifyAdminPassword(b,s,"MASTER_DELETE");if(!Set.of("users","roles").contains(coll))throw new ResponseStatusException(HttpStatus.BAD_REQUEST);Document d=byId(coll,id);if(d==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND);if("roles".equals(coll)&&!"ITADMIN".equals(who(s)))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Only ITADMIN can delete roles");if("users".equals(coll)){d.put("active",false);audit(d,s,false);db.save(d,coll);}else {if("roles".equals(coll))syncRolePermissions(id,Set.of());db.remove(Query.query(Criteria.where("_id").is(id)),coll);}log(id,String.valueOf(d.getOrDefault("username",d.getOrDefault("name",id))),coll.toUpperCase()+"_DEACTIVATED","ITADMIN","");return result("ok");}
 @PutMapping("/machine-access/{id}") public Object assignMachineAccess(@PathVariable String id,@RequestBody Map<String,Object> b,HttpSession s){require(s,true);Document u=byId("users",id);if(u==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND);verifyAdminPassword(b,s,"MACHINE_ACCESS_UPDATE");Object ids=b.get("machineIds");validateMachineIds(ids);u.put("machineIds",ids);audit(u,s,false);db.save(u,"users");log(id,u.getString("username"),"MACHINE_ACCESS_UPDATED",who(s),"");return result(safe(u));}
 @PostMapping("/admin/users/{id}/unlock") public Object unlock(@PathVariable String id,@RequestBody Map<String,String> b,HttpSession s){require(s,true);Document d=byId("users",id);if(d==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND);verifyAdminPassword(b,s,"ACCOUNT_UNLOCK");d.put("locked",false);d.put("failedAttempts",0);audit(d,s,false);db.save(d,"users");log(id,d.getString("username"),"ACCOUNT_UNLOCKED","ITADMIN",b.getOrDefault("comments",""));return result("ok");}
 @PostMapping("/admin/machines/register") public Object machineRequest(@RequestBody Map<String,String> b,HttpSession s){require(s,true);verifyAdminPassword(b,s,"MACHINE_CREATE");String name=b.getOrDefault("name","").trim();if(name.isBlank())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Name required");List<Document> existing=db.findAll(Document.class,"machines");int next=existing.stream().mapToInt(x->{try{return Integer.parseInt(x.getString("_id").substring(1));}catch(Exception e){return 0;}}).max().orElse(0)+1;String id=String.format("M%03d",next);Document machine=new Document("_id",id).append("name",name).append("capacity",b.getOrDefault("capacity","")).append("unit",b.getOrDefault("unit","")).append("active",true);audit(machine,s,true);db.insert(machine,"machines");log(id,name,"MACHINE_CREATED","ITADMIN","");return result(machine);}
 @GetMapping("/admin/sessions") public Object activeSessions(HttpSession s){require(s,true);long t=System.currentTimeMillis();List<Map<String,Object>> result=new ArrayList<>();for(var e:sessions.entrySet()){SessionInfo x=e.getValue();if(t-x.lastActivity>=IDLE_MS){endSession(x.session,"SESSION_TIMEOUT");continue;}result.add(Map.of("sessionId",e.getKey(),"userId",x.userId,"username",x.name,"loginTime",Instant.ofEpochMilli(x.loginTime).toString(),"lastActivity",Instant.ofEpochMilli(x.lastActivity).toString(),"currentSession",e.getKey().equals(s.getId())));}return result(result);}
 @PostMapping("/admin/sessions/{sessionId}/force-logout") public Object forceLogout(@PathVariable String sessionId,HttpSession s){require(s,true);SessionInfo target=sessions.get(sessionId);if(target==null)throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Session not found");if(sessionId.equals(s.getId()))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Use Logout for your own session");endSession(target.session,"FORCED_LOGOUT");log(target.userId,target.name,"SESSION_TERMINATED","ITADMIN","Forced logout");return result("ok");}
 @ExceptionHandler(Exception.class) public ResponseEntity<Map<String,String>> error(Exception e){if(e instanceof ResponseStatusException x)return ResponseEntity.status(x.getStatusCode()).body(Map.of("error",x.getReason()==null?"Request failed":x.getReason()));return ResponseEntity.status(500).body(Map.of("error","Server error"));}
}

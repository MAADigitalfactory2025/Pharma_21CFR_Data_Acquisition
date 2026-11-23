package com.gmp.dto;
import com.fasterxml.jackson.annotation.JsonAnyGetter;
import java.util.*;
/** Explicit API response boundary; preserves existing frontend keys while enriching references. */
public class MasterResponse {
 private final Map<String,Object> values;
 public MasterResponse(Map<String,Object> values){this.values=Collections.unmodifiableMap(new LinkedHashMap<>(values));}
 @JsonAnyGetter public Map<String,Object> values(){return values;}
}

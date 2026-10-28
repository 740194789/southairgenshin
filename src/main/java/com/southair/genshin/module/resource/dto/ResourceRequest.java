package com.southair.genshin.module.resource.dto;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;

/**
 * 资源更新请求：字段为空表示保持原值。
 */
public class ResourceRequest {

    @Min(value = 0, message = "原石不能为负数")
    @Max(value = 999999999L, message = "原石数值过大")
    private Long primogems;

    @Min(value = 0, message = "摩拉不能为负数")
    @Max(value = 999999999L, message = "摩拉数值过大")
    private Long mora;

    @Min(value = 0, message = "纠缠之缘不能为负数")
    @Max(value = 99999, message = "纠缠之缘数量过大")
    private Long intertwinedFates;

    @Min(value = 0, message = "相遇之缘不能为负数")
    @Max(value = 99999, message = "相遇之缘数量过大")
    private Long acquaintedFates;

    public Long getPrimogems() {
        return primogems;
    }

    public void setPrimogems(Long primogems) {
        this.primogems = primogems;
    }

    public Long getMora() {
        return mora;
    }

    public void setMora(Long mora) {
        this.mora = mora;
    }

    public Long getIntertwinedFates() {
        return intertwinedFates;
    }

    public void setIntertwinedFates(Long intertwinedFates) {
        this.intertwinedFates = intertwinedFates;
    }

    public Long getAcquaintedFates() {
        return acquaintedFates;
    }

    public void setAcquaintedFates(Long acquaintedFates) {
        this.acquaintedFates = acquaintedFates;
    }
}

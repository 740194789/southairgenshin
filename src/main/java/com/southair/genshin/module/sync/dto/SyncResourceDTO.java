package com.southair.genshin.module.sync.dto;

import java.io.Serializable;

/**
 * 同步用的资源快照：四个数值 + 客户端编辑时间。
 */
public class SyncResourceDTO implements Serializable {

    private static final long serialVersionUID = 1L;

    private Long primogems;
    private Long mora;
    private Long intertwinedFates;
    private Long acquaintedFates;
    private Long editedAt;

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

    public Long getEditedAt() {
        return editedAt;
    }

    public void setEditedAt(Long editedAt) {
        this.editedAt = editedAt;
    }
}

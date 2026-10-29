package com.southair.genshin.module.sync.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 同步用的抽卡记录：既是客户端上传结构，也是服务端快照返回结构。
 */
public class SyncRecordDTO implements Serializable {

    private static final long serialVersionUID = 1L;

    /** 客户端生成的稳定标识 */
    private String clientUid;

    private String itemName;
    private String itemType;
    private String pool;
    private Integer rarity;
    private Boolean isUp;
    private Integer pityCount;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime wishTime;

    private String note;

    /** 仅上传时使用：true 表示删除该条 */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Boolean deleted;

    /** 客户端编辑时间（epoch 毫秒） */
    private Long editedAt;

    public String getClientUid() {
        return clientUid;
    }

    public void setClientUid(String clientUid) {
        this.clientUid = clientUid;
    }

    public String getItemName() {
        return itemName;
    }

    public void setItemName(String itemName) {
        this.itemName = itemName;
    }

    public String getItemType() {
        return itemType;
    }

    public void setItemType(String itemType) {
        this.itemType = itemType;
    }

    public String getPool() {
        return pool;
    }

    public void setPool(String pool) {
        this.pool = pool;
    }

    public Integer getRarity() {
        return rarity;
    }

    public void setRarity(Integer rarity) {
        this.rarity = rarity;
    }

    public Boolean getIsUp() {
        return isUp;
    }

    public void setIsUp(Boolean isUp) {
        this.isUp = isUp;
    }

    public Integer getPityCount() {
        return pityCount;
    }

    public void setPityCount(Integer pityCount) {
        this.pityCount = pityCount;
    }

    public LocalDateTime getWishTime() {
        return wishTime;
    }

    public void setWishTime(LocalDateTime wishTime) {
        this.wishTime = wishTime;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public Boolean getDeleted() {
        return deleted;
    }

    public void setDeleted(Boolean deleted) {
        this.deleted = deleted;
    }

    public Long getEditedAt() {
        return editedAt;
    }

    public void setEditedAt(Long editedAt) {
        this.editedAt = editedAt;
    }
}

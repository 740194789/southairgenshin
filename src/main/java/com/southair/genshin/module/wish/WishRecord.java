package com.southair.genshin.module.wish;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.southair.genshin.common.BaseEntity;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.Index;
import javax.persistence.Table;
import java.time.LocalDateTime;

/**
 * 抽卡记录。
 */
@Entity
@Table(name = "t_wish_record", indexes = {
        @Index(name = "idx_wish_user", columnList = "user_id"),
        @Index(name = "idx_wish_client", columnList = "user_id,game,client_uid")
})
public class WishRecord extends BaseEntity {

    private static final long serialVersionUID = 1L;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonIgnore
    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 游戏：genshin（原神）/ starrail（崩坏：星穹铁道） */
    @Column(name = "game", length = 20)
    private String game;

    /** 抽到的角色 / 武器名称 */
    @Column(name = "item_name", nullable = false, length = 64)
    private String itemName;

    /** 角色 / 武器 */
    @Column(name = "item_type", length = 16)
    private String itemType;

    /** 角色活动 / 武器活动 / 常驻 */
    @Column(name = "pool", length = 16)
    private String pool;

    @Column(name = "rarity")
    private Integer rarity;

    /** 是否 UP 内出货 */
    @Column(name = "is_up")
    private Boolean isUp;

    /** 保底计数：该次出货时本保底周期内累计的抽数 */
    @JsonAlias("pity")
    @Column(name = "pity")
    private Integer pityCount;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    @Column(name = "wish_time")
    private LocalDateTime wishTime;

    @Column(length = 255)
    private String note;

    /** 客户端生成的稳定标识，多端同步时用于识别同一条记录 */
    @Column(name = "client_uid", length = 64)
    private String clientUid;

    /** 客户端编辑时间（epoch 毫秒），用于多端合并时判定新旧 */
    @Column(name = "edited_at")
    private Long editedAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public String getGame() {
        return game;
    }

    public void setGame(String game) {
        this.game = game;
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

    public String getClientUid() {
        return clientUid;
    }

    public void setClientUid(String clientUid) {
        this.clientUid = clientUid;
    }

    public Long getEditedAt() {
        return editedAt;
    }

    public void setEditedAt(Long editedAt) {
        this.editedAt = editedAt;
    }
}

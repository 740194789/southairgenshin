package com.southair.genshin.module.resource;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.southair.genshin.common.BaseEntity;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.Table;
import javax.persistence.UniqueConstraint;

/**
 * 账号资源：原石、摩拉、纠缠之缘、相遇之缘。
 *
 * <p>每个用户在每个游戏下仅一条记录。</p>
 */
@Entity
@Table(name = "t_account_resource", uniqueConstraints = {
        @UniqueConstraint(name = "uk_resource_user_game", columnNames = {"user_id", "game"})
})
public class AccountResource extends BaseEntity {

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

    /** 原石 / 星琼 */
    @Column(nullable = false)
    private Long primogems = 0L;

    /** 摩拉 / 信用点 */
    @Column(nullable = false)
    private Long mora = 0L;

    /** 纠缠之缘 / 星轨专票（限定池抽数） */
    @Column(name = "intertwined_fates", nullable = false)
    private Long intertwinedFates = 0L;

    /** 相遇之缘 / 星轨通票（常驻池抽数） */
    @Column(name = "acquainted_fates", nullable = false)
    private Long acquaintedFates = 0L;

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

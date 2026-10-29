package com.southair.genshin.module.sync;

import com.southair.genshin.common.BaseEntity;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.Table;
import javax.persistence.UniqueConstraint;

/**
 * 删除墓碑：记录某条客户端记录被删除的时间，防止其他端用旧数据把它「复活」。
 */
@Entity
@Table(name = "t_sync_tombstone", uniqueConstraints = {
        @UniqueConstraint(name = "uk_tombstone_user_game_uid",
                columnNames = {"user_id", "game", "client_uid"})
})
public class SyncTombstone extends BaseEntity {

    private static final long serialVersionUID = 1L;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "game", length = 20, nullable = false)
    private String game;

    @Column(name = "client_uid", length = 64, nullable = false)
    private String clientUid;

    /** 删除发生的客户端时间（epoch 毫秒） */
    @Column(name = "edited_at", nullable = false)
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

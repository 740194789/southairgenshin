package com.southair.genshin.module.wish;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.GenerationType;
import javax.persistence.Id;
import javax.persistence.Table;
import javax.persistence.UniqueConstraint;
import java.io.Serializable;

/**
 * 各卡池的当前保底进度快照。
 *
 * <p>抽卡记录只保留四星角色与五星物品，三星 / 四星武器在导入时会被丢弃，
 * 因此仅靠记录推导「已垫」会漏掉最近几抽。链接导入时把每个卡池的最终累计抽数存下来，
 * 统计页在快照比最新记录更新时优先使用它，使已垫与游戏内计数一致。</p>
 */
@Entity
@Table(name = "t_wish_pity", uniqueConstraints = {
        @UniqueConstraint(name = "uk_wish_pity", columnNames = {"user_id", "game", "pool"})
})
public class WishPitySnapshot implements Serializable {

    private static final long serialVersionUID = 1L;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 游戏：genshin（原神）/ starrail（崩坏：星穹铁道） */
    @Column(name = "game", length = 20, nullable = false)
    private String game;

    @Column(name = "pool", length = 16, nullable = false)
    private String pool;

    /** 该卡池当前累计了多少抽没有出五星（0 表示刚出过五星） */
    @Column(name = "pity")
    private Integer pityCount;

    /** 快照写入时间（毫秒），用于判断它是否比最新一条记录更新 */
    @Column(name = "updated_at")
    private Long updatedAt;

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

    public String getPool() {
        return pool;
    }

    public void setPool(String pool) {
        this.pool = pool;
    }

    public Integer getPityCount() {
        return pityCount;
    }

    public void setPityCount(Integer pityCount) {
        this.pityCount = pityCount;
    }

    public Long getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Long updatedAt) {
        this.updatedAt = updatedAt;
    }
}

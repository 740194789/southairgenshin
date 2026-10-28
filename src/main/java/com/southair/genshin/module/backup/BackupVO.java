package com.southair.genshin.module.backup;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.southair.genshin.module.resource.AccountResource;
import com.southair.genshin.module.wish.WishRecord;

import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 备份文件结构（导出 / 导入共用）。
 *
 * <pre>
 * {
 *   "app": "SouthAir Genshin",
 *   "version": 4,
 *   "game": "genshin",
 *   "exportedAt": "2026-10-28 09:00:00",
 *   "resource": { "primogems": 3200, "mora": 1200000, ... },
 *   "wishes": [ ... ]
 * }
 * </pre>
 */
public class BackupVO implements Serializable {

    private static final long serialVersionUID = 1L;

    private String app = "SouthAir Genshin";

    private int version = 4;

    /** genshin（原神）/ starrail（崩坏：星穹铁道） */
    private String game = "genshin";

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime exportedAt;

    /** 账号资源快照 */
    private AccountResource resource;

    private List<WishRecord> wishes = new ArrayList<>();

    public String getApp() {
        return app;
    }

    public void setApp(String app) {
        this.app = app;
    }

    public int getVersion() {
        return version;
    }

    public void setVersion(int version) {
        this.version = version;
    }

    public String getGame() {
        return game;
    }

    public void setGame(String game) {
        this.game = game;
    }

    public LocalDateTime getExportedAt() {
        return exportedAt;
    }

    public void setExportedAt(LocalDateTime exportedAt) {
        this.exportedAt = exportedAt;
    }

    public AccountResource getResource() {
        return resource;
    }

    public void setResource(AccountResource resource) {
        this.resource = resource;
    }

    public List<WishRecord> getWishes() {
        return wishes;
    }

    public void setWishes(List<WishRecord> wishes) {
        this.wishes = wishes;
    }
}

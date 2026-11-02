package com.southair.genshin.module.backup;

import com.fasterxml.jackson.annotation.JsonFormat;

import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 全量备份文件结构：一次包含两个游戏的数据，用于换设备与整体备份。
 *
 * <pre>
 * {
 *   "app": "SouthAir Genshin",
 *   "version": 5,
 *   "exportedAt": "2026-10-30 23:00:00",
 *   "games": {
 *     "genshin": { "resource": {...}, "wishes": [...] },
 *     "starrail": { "resource": {...}, "wishes": [...] }
 *   }
 * }
 * </pre>
 */
public class FullBackupVO implements Serializable {

    private static final long serialVersionUID = 1L;

    private String app = "SouthAir Genshin";

    private int version = 5;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime exportedAt;

    private Map<String, BackupVO> games = new LinkedHashMap<>();

    /** SHA-256 校验值（对除 checksum 外的内容做规范化 JSON 后计算）；旧备份为空 */
    private String checksum;

    /** 校验值生成端：southair-web / southair-mini；为空视为旧备份 */
    private String checksumApp;

    public String getChecksum() {
        return checksum;
    }

    public void setChecksum(String checksum) {
        this.checksum = checksum;
    }

    public String getChecksumApp() {
        return checksumApp;
    }

    public void setChecksumApp(String checksumApp) {
        this.checksumApp = checksumApp;
    }

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

    public LocalDateTime getExportedAt() {
        return exportedAt;
    }

    public void setExportedAt(LocalDateTime exportedAt) {
        this.exportedAt = exportedAt;
    }

    public Map<String, BackupVO> getGames() {
        return games;
    }

    public void setGames(Map<String, BackupVO> games) {
        this.games = games;
    }
}

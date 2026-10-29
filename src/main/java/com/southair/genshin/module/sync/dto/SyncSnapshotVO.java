package com.southair.genshin.module.sync.dto;

import java.io.Serializable;
import java.util.List;

/**
 * 同步快照：服务端在某游戏下的全量数据（不含已删除记录）。
 */
public class SyncSnapshotVO implements Serializable {

    private static final long serialVersionUID = 1L;

    private String game;

    /** 服务端时间（epoch 毫秒） */
    private long serverTime;

    private SyncResourceDTO resource;

    private List<SyncRecordDTO> records;

    public String getGame() {
        return game;
    }

    public void setGame(String game) {
        this.game = game;
    }

    public long getServerTime() {
        return serverTime;
    }

    public void setServerTime(long serverTime) {
        this.serverTime = serverTime;
    }

    public SyncResourceDTO getResource() {
        return resource;
    }

    public void setResource(SyncResourceDTO resource) {
        this.resource = resource;
    }

    public List<SyncRecordDTO> getRecords() {
        return records;
    }

    public void setRecords(List<SyncRecordDTO> records) {
        this.records = records;
    }
}

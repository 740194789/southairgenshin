package com.southair.genshin.module.sync.dto;

import java.io.Serializable;
import java.util.List;

/**
 * 多端合并请求：客户端把本地全量数据（含待同步的删除标记）推给服务端。
 */
public class SyncMergeRequest implements Serializable {

    private static final long serialVersionUID = 1L;

    private SyncResourceDTO resource;
    private List<SyncRecordDTO> records;

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

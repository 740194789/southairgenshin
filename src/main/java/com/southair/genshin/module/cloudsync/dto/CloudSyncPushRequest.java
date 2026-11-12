package com.southair.genshin.module.cloudsync.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 推送请求：payload 为待加密的全量备份，prevUpdatedAt 为本地最后一次拉取到的云端时间。
 */
public class CloudSyncPushRequest extends CloudSyncRequest {

    private JsonNode payload;

    private Long prevUpdatedAt;

    public JsonNode getPayload() {
        return payload;
    }

    public void setPayload(JsonNode payload) {
        this.payload = payload;
    }

    public Long getPrevUpdatedAt() {
        return prevUpdatedAt;
    }

    public void setPrevUpdatedAt(Long prevUpdatedAt) {
        this.prevUpdatedAt = prevUpdatedAt;
    }
}

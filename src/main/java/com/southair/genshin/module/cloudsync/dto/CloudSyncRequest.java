package com.southair.genshin.module.cloudsync.dto;

/**
 * 云同步基础请求：云端服务地址 + 同步码（同步码只在请求体中短暂出现，不写日志）。
 */
public class CloudSyncRequest {

    /** 云开发 HTTP 访问服务地址，例如 https://xxx.service.tcloudbase.com/syncStore */
    private String serviceUrl;

    private String code;

    public String getServiceUrl() {
        return serviceUrl;
    }

    public void setServiceUrl(String serviceUrl) {
        this.serviceUrl = serviceUrl;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }
}

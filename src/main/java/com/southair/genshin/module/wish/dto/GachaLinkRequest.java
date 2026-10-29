package com.southair.genshin.module.wish.dto;

/**
 * 抽卡链接导入请求：用户从游戏内复制的 getGachaLog 完整链接。
 */
public class GachaLinkRequest {

    private String url;

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }
}

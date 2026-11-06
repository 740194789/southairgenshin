package com.southair.genshin.module.user.dto;

import javax.validation.constraints.NotBlank;

/** 生成 / 重新生成恢复码时需要确认当前密码。 */
public class RecoveryCodeRequest {

    @NotBlank(message = "当前密码不能为空")
    private String currentPassword;

    public String getCurrentPassword() {
        return currentPassword;
    }

    public void setCurrentPassword(String currentPassword) {
        this.currentPassword = currentPassword;
    }
}

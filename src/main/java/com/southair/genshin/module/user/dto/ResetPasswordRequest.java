package com.southair.genshin.module.user.dto;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/** 忘记密码时用「账号 + 恢复码」重置，成功后直接返回登录凭证。 */
public class ResetPasswordRequest {

    @NotBlank(message = "账号不能为空")
    private String username;

    @NotBlank(message = "恢复码不能为空")
    private String recoveryCode;

    @NotBlank(message = "新密码不能为空")
    @Size(min = 6, max = 64, message = "密码长度需在 6-64 位之间")
    private String newPassword;

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getRecoveryCode() {
        return recoveryCode;
    }

    public void setRecoveryCode(String recoveryCode) {
        this.recoveryCode = recoveryCode;
    }

    public String getNewPassword() {
        return newPassword;
    }

    public void setNewPassword(String newPassword) {
        this.newPassword = newPassword;
    }
}

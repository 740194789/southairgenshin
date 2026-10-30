package com.southair.genshin.module.user.dto;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Size;

/**
 * 修改用户名（昵称）请求。
 *
 * <p>登录账号与密码不在此接口内修改；用户名仅用于页面显示。</p>
 */
public class UpdateProfileRequest {

    @NotBlank(message = "用户名不能为空")
    @Size(max = 32, message = "用户名最长 32 位")
    private String nickname;

    public String getNickname() {
        return nickname;
    }

    public void setNickname(String nickname) {
        this.nickname = nickname;
    }
}

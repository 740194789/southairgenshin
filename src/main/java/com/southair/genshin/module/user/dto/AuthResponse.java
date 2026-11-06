package com.southair.genshin.module.user.dto;

import java.io.Serializable;

/**
 * 登录 / 注册成功后返回的凭证。
 */
public class AuthResponse implements Serializable {

    private static final long serialVersionUID = 1L;

    private String token;
    private UserVO user;
    /** 注册 / 重新生成时返回一次明文恢复码；其他场景为 null */
    private String recoveryCode;

    public AuthResponse() {
    }

    public AuthResponse(String token, UserVO user) {
        this.token = token;
        this.user = user;
    }

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public UserVO getUser() {
        return user;
    }

    public void setUser(UserVO user) {
        this.user = user;
    }

    public String getRecoveryCode() {
        return recoveryCode;
    }

    public void setRecoveryCode(String recoveryCode) {
        this.recoveryCode = recoveryCode;
    }
}

package com.southair.genshin.module.user.dto;

import java.io.Serializable;

/**
 * 登录 / 注册成功后返回的凭证。
 */
public class AuthResponse implements Serializable {

    private static final long serialVersionUID = 1L;

    private String token;
    private UserVO user;

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
}

package com.southair.genshin.module.user;

import com.southair.genshin.common.R;
import com.southair.genshin.module.user.dto.AuthResponse;
import com.southair.genshin.module.user.dto.LoginRequest;
import com.southair.genshin.module.user.dto.RegisterRequest;
import com.southair.genshin.module.user.dto.UserVO;
import com.southair.genshin.security.UserContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.validation.Valid;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserService userService;

    public AuthController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping("/register")
    public R<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
        return R.ok(userService.register(request));
    }

    @PostMapping("/login")
    public R<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        return R.ok(userService.login(request));
    }

    @GetMapping("/me")
    public R<UserVO> me() {
        return R.ok(userService.getProfile(UserContext.require()));
    }
}

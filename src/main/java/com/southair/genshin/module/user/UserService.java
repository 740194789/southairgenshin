package com.southair.genshin.module.user;

import com.southair.genshin.common.BusinessException;
import com.southair.genshin.module.user.dto.AuthResponse;
import com.southair.genshin.module.user.dto.LoginRequest;
import com.southair.genshin.module.user.dto.RegisterRequest;
import com.southair.genshin.module.user.dto.UserVO;
import com.southair.genshin.security.JwtUtil;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder, JwtUtil jwtUtil) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtil = jwtUtil;
    }

    /**
     * 注册并直接返回登录凭证。
     */
    @Transactional
    public AuthResponse register(RegisterRequest request) {
        String username = request.getUsername().trim();
        if (userRepository.existsByUsername(username)) {
            throw new BusinessException("该账号已被注册");
        }

        User user = new User();
        user.setUsername(username);
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setNickname(StringUtils.hasText(request.getNickname())
                ? request.getNickname().trim()
                : username);
        user.setRole("USER");
        userRepository.save(user);

        return buildAuthResponse(user);
    }

    @Transactional(readOnly = true)
    public AuthResponse login(LoginRequest request) {
        User user = userRepository.findByUsername(request.getUsername().trim())
                .orElseThrow(() -> new BusinessException("账号或密码错误"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new BusinessException("账号或密码错误");
        }
        return buildAuthResponse(user);
    }

    @Transactional(readOnly = true)
    public UserVO getProfile(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(404, "用户不存在"));
        return UserVO.from(user);
    }

    private AuthResponse buildAuthResponse(User user) {
        String token = jwtUtil.generate(user.getId(), user.getUsername());
        return new AuthResponse(token, UserVO.from(user));
    }
}

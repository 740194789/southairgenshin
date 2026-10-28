package com.southair.genshin.module.resource;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface AccountResourceRepository extends JpaRepository<AccountResource, Long> {

    Optional<AccountResource> findByUserIdAndGame(Long userId, String game);
}

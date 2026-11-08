package com.southair.genshin.module.wish;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WishPitySnapshotRepository extends JpaRepository<WishPitySnapshot, Long> {

    List<WishPitySnapshot> findByUserIdAndGame(Long userId, String game);

    WishPitySnapshot findByUserIdAndGameAndPool(Long userId, String game, String pool);

    void deleteByUserIdAndGame(Long userId, String game);
}

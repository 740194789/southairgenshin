package com.southair.genshin.module.sync;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SyncTombstoneRepository extends JpaRepository<SyncTombstone, Long> {

    Optional<SyncTombstone> findFirstByUserIdAndGameAndClientUid(Long userId, String game, String clientUid);

    void deleteByUserIdAndGameAndClientUid(Long userId, String game, String clientUid);
}

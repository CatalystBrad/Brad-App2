import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {Deal, DealsFeed} from '../types';
import {loadFeed} from '../services/dealsFeed';
import {runBackgroundRefresh} from '../services/backgroundFetch';

const BOARD_LABELS: Record<string, string> = {
  AI: 'All Inclusive',
  HB: 'Half Board',
  FB: 'Full Board',
  BB: 'B&B',
  SC: 'Self Catering',
  RO: 'Room Only',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 36e5);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const DealsScreen = () => {
  const [feed, setFeed] = useState<DealsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async (force: boolean) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const result = await loadFeed(force);
    setFeed(result.feed);
    if (result.error) setError(result.error);
    setLoading(false);
    setRefreshing(false);
    if (force) {
      runBackgroundRefresh().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const filtered = useMemo(() => {
    if (!feed) return [];
    const q = query.trim().toLowerCase();
    const items = feed.deals;
    if (!q) return items;
    return items.filter(d => {
      const haystack = `${d.title} ${d.destination} ${d.country ?? ''} ${d.hotelName ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [feed, query]);

  const openDeal = (deal: Deal) => {
    Linking.openURL(deal.url).catch(() => undefined);
  };

  const renderDeal = ({item}: {item: Deal}) => {
    const board = item.boardType ? BOARD_LABELS[item.boardType] : undefined;
    return (
      <TouchableOpacity style={styles.card} onPress={() => openDeal(item)}>
        {item.imageUrl ? (
          <Image source={{uri: item.imageUrl}} style={styles.cardImage} resizeMode="cover" />
        ) : (
          <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
            <Text style={styles.cardImagePlaceholderText}>{item.destination}</Text>
          </View>
        )}
        <View style={styles.cardBody}>
          <View style={styles.cardHeader}>
            <Text style={styles.destination}>{item.destination}</Text>
            {item.pricePerPerson != null && (
              <View style={styles.priceBadge}>
                <Text style={styles.priceText}>£{Math.round(item.pricePerPerson)}</Text>
                <Text style={styles.pricePer}>pp</Text>
              </View>
            )}
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={styles.metaRow}>
            {item.nights != null && (
              <Text style={styles.meta}>{item.nights} nights</Text>
            )}
            {board && <Text style={styles.meta}>{board}</Text>}
            {item.hotelRating != null && (
              <Text style={styles.meta}>{'★'.repeat(item.hotelRating)}</Text>
            )}
          </View>
          <View style={styles.footerRow}>
            <Text style={styles.sourceTag}>{item.source}</Text>
            <Text style={styles.scrapedAt}>{timeAgo(item.scrapedAt)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading && !feed) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loaderText}>Loading deals…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Filter by destination, hotel, country…"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {error && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={d => d.id}
        renderItem={renderDeal}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No deals yet</Text>
            <Text style={styles.emptyBody}>
              {feed?.generatedAt
                ? 'No matches for that filter.'
                : 'Waiting for the daily scrape to land on GitHub.'}
            </Text>
          </View>
        }
        ListHeaderComponent={
          feed ? (
            <Text style={styles.headerMeta}>
              {feed.count} deals · refreshed {timeAgo(feed.generatedAt)}
            </Text>
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#F2F2F7'},
  loaderContainer: {flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F2F2F7'},
  loaderText: {marginTop: 12, color: '#8E8E93'},
  searchBar: {padding: 12, backgroundColor: '#F2F2F7'},
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  banner: {backgroundColor: '#FFE9C4', padding: 10},
  bannerText: {color: '#5A3E00', fontSize: 13},
  list: {paddingHorizontal: 12, paddingBottom: 24},
  headerMeta: {color: '#8E8E93', fontSize: 12, marginBottom: 8, marginLeft: 4},
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardImage: {width: '100%', height: 160, backgroundColor: '#E5E5EA'},
  cardImagePlaceholder: {justifyContent: 'center', alignItems: 'center'},
  cardImagePlaceholderText: {color: '#8E8E93', fontSize: 16, fontWeight: '600'},
  cardBody: {padding: 14},
  cardHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'},
  destination: {fontSize: 18, fontWeight: 'bold', color: '#000', flex: 1, marginRight: 8},
  priceBadge: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  priceText: {color: '#FFFFFF', fontSize: 16, fontWeight: 'bold'},
  pricePer: {color: '#FFFFFF', fontSize: 11, marginLeft: 3, opacity: 0.85},
  title: {fontSize: 14, color: '#3C3C43', marginTop: 6},
  metaRow: {flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 8},
  meta: {fontSize: 12, color: '#8E8E93', backgroundColor: '#F2F2F7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6},
  footerRow: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 10},
  sourceTag: {fontSize: 11, color: '#007AFF', textTransform: 'uppercase', fontWeight: '600'},
  scrapedAt: {fontSize: 11, color: '#8E8E93'},
  empty: {alignItems: 'center', marginTop: 80, padding: 20},
  emptyTitle: {fontSize: 18, fontWeight: 'bold', color: '#8E8E93', marginBottom: 8},
  emptyBody: {fontSize: 14, color: '#8E8E93', textAlign: 'center'},
});

export default DealsScreen;

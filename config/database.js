const mongoose = require('mongoose');

class Database {
  constructor() {
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) {
      console.log('✅ Database already connected');
      return;
    }

    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/otp-authenticator';
      
      const options = {
        maxPoolSize: 10, // Maintain up to 10 socket connections
        serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds
        family: 4 // Use IPv4, skip trying IPv6
      };

      await mongoose.connect(mongoUri, options);
      
      this.isConnected = true;
      console.log('✅ MongoDB connected successfully');
      console.log(`📊 Database: ${mongoose.connection.name}`);
      console.log(`🔗 Host: ${mongoose.connection.host}:${mongoose.connection.port}`);

      // Handle connection events
      mongoose.connection.on('error', (error) => {
        console.error('❌ MongoDB connection error:', error);
        this.isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ MongoDB disconnected');
        this.isConnected = false;
      });

      mongoose.connection.on('reconnected', () => {
        console.log('🔄 MongoDB reconnected');
        this.isConnected = true;
      });

      // Graceful shutdown
      process.on('SIGINT', async () => {
        await this.disconnect();
        process.exit(0);
      });

    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      
      if (error.message.includes('ECONNREFUSED')) {
        console.log('💡 Make sure MongoDB is running on your system');
        console.log('   - Install MongoDB: https://docs.mongodb.com/manual/installation/');
        console.log('   - Start MongoDB service');
        console.log('   - Or use MongoDB Atlas (cloud): https://www.mongodb.com/atlas');
      }
      
      throw error;
    }
  }

  async disconnect() {
    if (!this.isConnected) {
      return;
    }

    try {
      await mongoose.connection.close();
      this.isConnected = false;
      console.log('📄 MongoDB disconnected gracefully');
    } catch (error) {
      console.error('❌ Error disconnecting from MongoDB:', error);
    }
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name,
      collections: Object.keys(mongoose.connection.collections)
    };
  }

  async healthCheck() {
    try {
      if (!this.isConnected) {
        throw new Error('Database not connected');
      }

      // Simple ping to check if database is responding
      await mongoose.connection.db.admin().ping();
      
      return {
        status: 'healthy',
        connection: 'active',
        readyState: mongoose.connection.readyState,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        readyState: mongoose.connection.readyState,
        timestamp: new Date().toISOString()
      };
    }
  }

  async getStats() {
    try {
      if (!this.isConnected) {
        throw new Error('Database not connected');
      }

      const db = mongoose.connection.db;
      const stats = await db.stats();
      
      // Get collection stats
      const collections = {};
      for (const collectionName of Object.keys(mongoose.connection.collections)) {
        try {
          const collectionStats = await db.collection(collectionName).stats();
          collections[collectionName] = {
            documents: collectionStats.count,
            size: collectionStats.size,
            indexes: collectionStats.nindexes
          };
        } catch (error) {
          collections[collectionName] = { error: error.message };
        }
      }

      return {
        database: {
          name: stats.db,
          collections: stats.collections,
          objects: stats.objects,
          dataSize: stats.dataSize,
          storageSize: stats.storageSize,
          indexes: stats.indexes,
          indexSize: stats.indexSize
        },
        collections: collections,
        connection: {
          host: mongoose.connection.host,
          port: mongoose.connection.port,
          readyState: mongoose.connection.readyState
        }
      };
    } catch (error) {
      throw new Error(`Failed to get database stats: ${error.message}`);
    }
  }
}

// Export singleton instance
const database = new Database();

module.exports = database;

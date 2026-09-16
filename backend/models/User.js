const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    isAdmin: {
      type: Boolean,
      required: true,
      default: false,
    },
    shippingAddresses: [
      {
        fullName: String,
        address: String,
        city: String,
        state: String,
        postalCode: String,
        country: String,
        phoneNumber: String,
      }
    ],
    // Optional saved body measurements (cm) for the AI Size Recommendation
    // feature. Never required to use the feature — a guest or logged-in
    // user can always enter one-off measurements instead.
    fitProfile: {
      height: Number,
      weight: Number,
      chest: Number,
      waist: Number,
      hip: Number,
      shoulder: Number,
      fitPreference: {
        type: String,
        enum: ['slim', 'regular', 'relaxed', 'oversized'],
        default: 'regular',
      },
    },
  },
  {
    timestamps: true,
  }
);

// Method to compare entered password with hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Middleware to hash password before saving to database
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const User = mongoose.model('User', userSchema);

module.exports = User;